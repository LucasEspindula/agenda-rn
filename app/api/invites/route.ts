import { z } from "zod";
import { getSession, isManager } from "@/app/authz";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";
import { consumeLimit } from "@/lib/security/rate-limit";
import { appOrigin, emails, newEmailToken, sendMail } from "@/lib/email";

const body = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  name: z.string().trim().max(120).optional(),
  role: z.enum(["general_manager", "secretary", "doctor"]),
  agendaIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(500).optional(),
  doctorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
}).strict();

// A gerência convida por e-mail para a organização ativa; o banco confere papel, médico e agendas.
async function invite(request: Request) {
  const session = await getSession();
  if (!session || !isManager(session.account.role)) throw new HttpError(403, "Somente a gerência envia convites.");
  await consumeLimit("invite-actor", String(session.account.id), 30, 3600);
  const parsed = body.safeParse(await readJson(request, 8192));
  if (!parsed.success) throw new HttpError(400, "Confira o e-mail e o papel do convite.");
  const data = parsed.data, { token, hash } = newEmailToken(), origin = appOrigin(request);
  const result = await getSupabaseAdmin().rpc("create_invite", {
    p_actor: session.account.id, p_org: session.organization.id, p_email: data.email, p_name: data.name ?? null,
    p_role: data.role, p_agenda_ids: data.agendaIds ?? null, p_doctor_id: data.doctorId ?? null, p_token_hash: hash,
  });
  if (result.error) throw new HttpError(result.error.code === "P0001" ? 409 : 500, result.error.code === "P0001" ? result.error.message : "Não foi possível criar o convite.");
  await sendMail(emails.invite(data.email, session.organization.name, session.account.name || session.account.email, `${origin}/convite?token=${token}`));
  return Response.json({ ok: true, message: `Convite enviado para ${data.email}.` });
}
export const POST = secureMutation(invite);

// Cancela um convite pendente da organização ativa (o link deixa de funcionar).
async function cancel(request: Request) {
  const session = await getSession();
  if (!session || !isManager(session.account.role)) throw new HttpError(403, "Somente a gerência cancela convites.");
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!z.string().uuid().safeParse(id).success) throw new HttpError(400, "Convite inválido.");
  const result = await getSupabaseAdmin().rpc("cancel_invite", { p_actor: session.account.id, p_org: session.organization.id, p_invite: id });
  if (result.error) throw new HttpError(result.error.code === "P0001" ? 409 : 500, result.error.code === "P0001" ? result.error.message : "Não foi possível cancelar o convite.");
  return Response.json({ ok: true, message: "Convite cancelado." });
}
export const DELETE = secureMutation(cancel);
