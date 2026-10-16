import { getSession } from "@/app/authz";
import { canManageInsurance } from "@/lib/insurance-control";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";
import { isPerseusOperationalEnabled, perseusUnavailableMessage } from "@/lib/perseu/availability";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const PATCH = secureMutation(async (request) => {
  if (!isPerseusOperationalEnabled()) throw new HttpError(404, perseusUnavailableMessage);
  const session = await getSession();
  if (!session || !canManageInsurance(session.account.role)) throw new HttpError(403, "Acesso restrito à Gerência.");
  const body = await readJson(request), id = body.id, status = body.status;
  if (typeof id !== "string" || !uuid.test(id) || !["REVIEWED", "DISMISSED"].includes(status)) throw new HttpError(400, "Proposta inválida.");
  const reviewData = body.reviewData;
  if (status === "REVIEWED" && (!reviewData || typeof reviewData !== "object" || Array.isArray(reviewData) || reviewData.confirmed !== true))
    throw new HttpError(400, "Confirme a revisão antes de concluir a proposta.");
  const db = getSupabaseAdmin();
  const result = await db.from("perseus_operational_proposals").update({ status, reviewed_at: new Date().toISOString(), reviewed_by: session.account.id, review_data: reviewData || {} }).eq("id", id).eq("status", "PROPOSED").select("document_id").maybeSingle();
  if (result.error || !result.data) throw new HttpError(409, "A proposta não está mais disponível para revisão.");
  await db.from("perseus_global_events").insert({ document_id: result.data.document_id, event_type: status === "REVIEWED" ? "PROPOSAL_REVIEWED" : "PROPOSAL_DISMISSED", actor_id: session.account.id, event_metadata: { proposal_id: id } });
  return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
});
export const POST = PATCH;
