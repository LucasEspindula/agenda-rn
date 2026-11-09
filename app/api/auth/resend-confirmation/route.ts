import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";
import { consumeLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client";
import { appOrigin, emails, newEmailToken, sendMail } from "@/lib/email";

const done = () => Response.json({ ok: true, message: "Se houver um cadastro aguardando confirmação, enviamos um novo link." });

async function resend(request: Request) {
  await consumeLimit("verify-resend-ip", clientIp(request), 10, 3600);
  const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict().safeParse(await readJson(request, 1024));
  if (!parsed.success) throw new HttpError(400, "Informe um e-mail válido.");
  await consumeLimit("verify-resend-email", parsed.data.email, 3, 3600);
  const { token, hash } = newEmailToken();
  const result = await getSupabaseAdmin().rpc("renew_email_verification", { p_email: parsed.data.email, p_token_hash: hash });
  if (result.error) throw new HttpError(500, "Não foi possível enviar o link.");
  if (result.data) await sendMail(emails.confirm(parsed.data.email, "", `${appOrigin(request)}/confirmar-email?token=${token}`));
  return done();
}
export const POST = secureMutation(resend);
