import { z } from "zod";
import { hashPassword } from "@/app/passwords";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";
import { consumeLimit } from "@/lib/security/rate-limit";
import { clientIp } from "@/lib/security/client";
import { passwordProblem } from "@/lib/security/password-policy";
import { appOrigin, emails, newEmailToken, requireEmailDelivery, sendMail } from "@/lib/email";
import { TERMS_VERSION, publicSignupEnabled } from "@/lib/legal";

const body = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(128),
  organizationName: z.string().trim().min(2).max(120),
  organizationKind: z.enum(["MANAGEMENT_COMPANY", "CLINIC", "SOLO_DOCTOR"]),
  acceptTerms: z.literal(true),
}).strict();

// A resposta é a mesma com e-mail novo ou já cadastrado (não revela contas existentes).
const done = () => Response.json({ ok: true, message: "Enviamos um e-mail para confirmar seu cadastro. Abra o link para ativar a conta." });

async function signup(request: Request) {
  if (!publicSignupEnabled()) throw new HttpError(404, "Cadastro indisponível.");
  requireEmailDelivery();
  await consumeLimit("signup-ip", clientIp(request), 5, 3600);
  const parsed = body.safeParse(await readJson(request, 4096));
  if (!parsed.success) throw new HttpError(400, "Confira os dados. A senha precisa ter de 12 a 128 caracteres e os termos precisam ser aceitos.");
  const data = parsed.data;
  const problem = passwordProblem(data.password, data.email);
  if (problem) throw new HttpError(400, problem);
  await consumeLimit("signup-email", data.email, 3, 3600);
  const origin = appOrigin(request), { token, hash } = newEmailToken(), credentials = await hashPassword(data.password);
  const result = await getSupabaseAdmin().rpc("signup_account", {
    p_email: data.email, p_name: data.name, p_hash: credentials.hash, p_salt: credentials.salt,
    p_org_name: data.organizationName, p_org_kind: data.organizationKind, p_terms_version: TERMS_VERSION, p_token_hash: hash,
  });
  if (result.error) {
    if (String(result.error.message).includes("Já existe uma conta")) { await sendMail(emails.alreadyRegistered(data.email, `${origin}/`)); return done(); }
    throw new HttpError(result.error.code === "P0001" ? 400 : 500, result.error.code === "P0001" ? result.error.message : "Não foi possível concluir o cadastro.");
  }
  await sendMail(emails.confirm(data.email, data.name, `${origin}/confirmar-email?token=${token}`));
  return done();
}
export const POST = secureMutation(signup);
