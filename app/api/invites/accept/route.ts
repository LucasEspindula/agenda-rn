import { z } from "zod";
import { getSession } from "@/app/authz";
import { hashPassword } from "@/app/passwords";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";
import { consumeLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client";
import { hashEmailToken, validEmailToken } from "@/lib/email";

// Conta nova: nome + senha. Conta existente: precisa estar logada com o mesmo e-mail.
async function accept(request: Request) {
  await consumeLimit("invite-accept-ip", clientIp(request), 20, 3600);
  const parsed = z.object({ token: z.string(), name: z.string().trim().max(120).optional(), password: z.string().min(12).max(128).optional() }).strict()
    .safeParse(await readJson(request, 2048));
  if (!parsed.success || !validEmailToken(parsed.data.token)) throw new HttpError(400, "Convite inválido. A senha precisa ter de 12 a 128 caracteres.");
  const session = await getSession();
  const credentials = parsed.data.password ? await hashPassword(parsed.data.password) : null;
  const result = await getSupabaseAdmin().rpc("accept_invite", {
    p_token_hash: hashEmailToken(parsed.data.token), p_session_user: session?.account.id ?? null,
    p_name: parsed.data.name ?? null, p_hash: credentials?.hash ?? null, p_salt: credentials?.salt ?? null,
  });
  if (result.error) throw new HttpError(result.error.code === "P0001" ? 409 : 500, result.error.code === "P0001" ? result.error.message : "Não foi possível aceitar o convite.");
  return Response.json({ ok: true, loggedIn: Boolean(session), message: session ? "Convite aceito. Escolha a organização no topo da tela." : "Conta criada. Entre com seu e-mail e a senha que você escolheu." });
}
export const POST = secureMutation(accept);
