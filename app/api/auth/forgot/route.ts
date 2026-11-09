import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";
import { consumeLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client";
import { appOrigin, emails, newEmailToken, sendMail } from "@/lib/email";

// Mesma resposta exista ou não a conta.
const done = () => Response.json({ ok: true, message: "Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha. Ele vale por 1 hora." });

async function forgot(request: Request) {
  await consumeLimit("reset-ip", clientIp(request), 10, 3600);
  const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict().safeParse(await readJson(request, 1024));
  if (!parsed.success) throw new HttpError(400, "Informe um e-mail válido.");
  await consumeLimit("reset-email", parsed.data.email, 3, 3600);
  const { token, hash } = newEmailToken();
  const result = await getSupabaseAdmin().rpc("request_password_reset", { p_email: parsed.data.email, p_token_hash: hash });
  if (result.error) throw new HttpError(500, "Não foi possível enviar o link.");
  const user = result.data as { name?: string; email: string } | null;
  if (user) await sendMail(emails.reset(user.email, user.name || "", `${appOrigin(request)}/redefinir-senha?token=${token}`));
  return done();
}
export const POST = secureMutation(forgot);
