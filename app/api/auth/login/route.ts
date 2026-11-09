import { cookies } from "next/headers";
import { SESSION_COOKIE, hasActiveMembership, type Role } from "@/app/authz";
import { hashPassword, hashToken, verifyPassword } from "@/app/passwords";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";
import { readJson, secureMutation } from "@/lib/security/http";
import { consumeLimit } from "@/lib/security/rate-limit";

async function login(request: Request) {
  await consumeLimit("login-global", "all", 300, 60);
  const data = await readJson(request, 4096);
  const invalid = () => Response.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
  if (typeof data.email !== "string" || typeof data.password !== "string" || data.email.length > 254 || data.password.length > 128 || data.password.length < 8) return invalid();
  const email = data.email.trim().toLowerCase(), password = data.password;
  await consumeLimit("login-account", email, 10, 900);
  // Vercel owns this header. The global/account limits remain effective without it.
  if (process.env.VERCEL === "1") await consumeLimit("login-ip", request.headers.get("x-vercel-forwarded-for") || "unknown", 30, 300);
  const db = getSupabaseAdmin();
  const found = await db.from("users").select("id,role,active,password_hash,password_salt,email_verified_at").eq("email", email).maybeSingle();
  dbError(found.error, "Read account"); const account = found.data;
  if (!account?.active || !account.password_hash || !account.password_salt || !["general_manager","secretary","doctor"].includes(account.role)) {
    await hashPassword(password); // No distinguishable fast path for unknown accounts.
    return invalid();
  }
  if (!await verifyPassword(password, account.password_hash, account.password_salt)) {
    if (!account.password_hash.startsWith("pbkdf2-sha256$600000$")) await hashPassword(password,undefined,500_000);
    return invalid();
  }
  if (!await hasActiveMembership(db,Number(account.id),account.role as Role)) return invalid();
  // Autocadastro só entra depois de confirmar o e-mail (a senha já foi conferida).
  if (!account.email_verified_at) return Response.json({ error: "Confirme seu e-mail antes de entrar. Procure o link na sua caixa de entrada.", unverified: true }, { status: 403 });
  // Limpeza ocasional de sessões e links vencidos.
  if (Math.random() < 0.05) await db.rpc("purge_expired_auth").then(() => undefined, () => undefined);
  if (!account.password_hash.startsWith("pbkdf2-sha256$600000$")) {
    const credentials = await hashPassword(password);
    const upgraded = await db.from("users").update({ password_hash: credentials.hash, password_salt: credentials.salt }).eq("id",account.id).eq("password_hash",account.password_hash).select("id").maybeSingle();
    dbError(upgraded.error,"Upgrade password"); if (!upgraded.data) return invalid();
  }
  const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 8 * 3600000);
  const created = await db.from("sessions").insert({ token_hash: await hashToken(token), user_id: account.id, expires_at: expiresAt.toISOString() });
  dbError(created.error, "Create session");
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "strict", path: "/", expires: expiresAt });
  return Response.json({ ok: true });
}
export const POST = secureMutation(login);
