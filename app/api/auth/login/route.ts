import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/app/authz";
import { hashPassword, hashToken, verifyPassword } from "@/app/passwords";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";

const INITIAL_MANAGER_EMAIL = "lucasespindula42@gmail.com";

export async function POST(request: Request) {
  const data = await request.json() as { email?: string; password?: string };
  const email = data.email?.trim().toLowerCase() ?? "", password = data.password ?? "";
  if (!email || password.length < 8) return Response.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
  const db = getSupabaseAdmin();
  const initialAccount = await db.from("users").select("*").eq("email", email).maybeSingle();
  let account = initialAccount.data;
  dbError(initialAccount.error, "Read account");
  if (!account && email === INITIAL_MANAGER_EMAIL) {
    const inserted = await db.from("users").insert({ email, name: "Lucas", role: "general_manager" }).select("*").single();
    dbError(inserted.error, "Create initial manager"); account = inserted.data;
  }
  if (!account) return Response.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
  if (!account.password_hash || !account.password_salt) {
    const initialPassword = process.env.INITIAL_MANAGER_PASSWORD;
    if (email !== INITIAL_MANAGER_EMAIL || !initialPassword || password !== initialPassword) return Response.json({ error: "Senha ainda não configurada. Fale com o Gerente geral." }, { status: 401 });
    const credentials = await hashPassword(password);
    const updated = await db.from("users").update({ password_hash: credentials.hash, password_salt: credentials.salt, updated_at: new Date().toISOString() }).eq("id", account.id).select("*").single();
    dbError(updated.error, "Set manager password"); account = updated.data;
  } else if (!await verifyPassword(password, account.password_hash, account.password_salt)) return Response.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
  const token = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const created = await db.from("sessions").insert({ token_hash: await hashToken(token), user_id: account.id, expires_at: expiresAt });
  dbError(created.error, "Create session");
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: new Date(expiresAt) });
  return Response.json({ ok: true });
}
