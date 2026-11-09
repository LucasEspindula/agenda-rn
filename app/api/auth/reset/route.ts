import { z } from "zod";
import { hashPassword } from "@/app/passwords";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";
import { consumeLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client";
import { hashEmailToken, validEmailToken } from "@/lib/email";

async function reset(request: Request) {
  await consumeLimit("reset-submit-ip", clientIp(request), 20, 3600);
  const parsed = z.object({ token: z.string(), password: z.string().min(12).max(128) }).strict().safeParse(await readJson(request, 2048));
  if (!parsed.success || !validEmailToken(parsed.data.token)) throw new HttpError(400, "A nova senha precisa ter de 12 a 128 caracteres.");
  const credentials = await hashPassword(parsed.data.password);
  const result = await getSupabaseAdmin().rpc("reset_password", { p_token_hash: hashEmailToken(parsed.data.token), p_hash: credentials.hash, p_salt: credentials.salt });
  if (result.error) throw new HttpError(400, "Link inválido ou expirado. Peça um novo em “Esqueci minha senha”.");
  return Response.json({ ok: true, message: "Senha alterada. Entre com a nova senha." });
}
export const POST = secureMutation(reset);
