import { z } from "zod";
import { getSession, isManager } from "@/app/authz";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";
import { consumeLimit } from "@/lib/security/rate-limit";

const BUCKET = "surgery-documents";

// Pedido de eliminação do titular (LGPD art. 18, VI): anonimiza quando não há obrigação de guarda.
// O banco recusa paciente com atendimento realizado ou agendamento futuro ativo.
async function anonymize(request: Request) {
  const session = await getSession();
  if (!session || !isManager(session.account.role)) throw new HttpError(403, "Somente a gerência anonimiza pacientes.");
  const id = new URL(request.url).pathname.split("/").at(-2) || "";
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new HttpError(400, "Paciente inválido.");
  await consumeLimit("patient-anonymize", String(session.account.id), 20, 3600);
  const parsed = z.object({ reason: z.string().trim().min(10).max(500), confirm: z.literal("ANONIMIZAR") }).strict().safeParse(await readJson(request, 2048));
  if (!parsed.success) throw new HttpError(400, "Descreva o motivo (mínimo 10 caracteres) e digite ANONIMIZAR para confirmar.");
  const db = getSupabaseAdmin();
  const { data, error } = await db.rpc("anonymize_patient", { p_actor: session.account.id, p_org: session.organization.id, p_patient: id, p_reason: parsed.data.reason });
  if (error) throw new HttpError(error.code === "P0001" ? 409 : 500, error.code === "P0001" ? error.message : "Não foi possível anonimizar.");
  const paths = ((data as { objectPaths?: string[] })?.objectPaths || []).filter(Boolean);
  // Os registros dos documentos já saíram do banco; os arquivos são removidos do armazenamento.
  if (paths.length) {
    const removed = await db.storage.from(BUCKET).remove(paths);
    if (removed.error) console.error("[lgpd] storage cleanup failed", removed.error.message);
  }
  return Response.json({ ok: true, message: "Paciente anonimizado. Os agendamentos passados continuam na agenda sem dados pessoais." });
}
export const POST = secureMutation(anonymize);
