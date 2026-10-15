import { getSession } from "@/app/authz";
import { canManageInsurance } from "@/lib/insurance-control";
import { inspectGlobalPerseusDocument, type PerseusDocumentClass } from "@/lib/perseu/document-intelligence";
import { inspectWithOpenAI, multimodalAvailability } from "@/lib/perseu/multimodal-provider";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { consumeLimit } from "@/lib/security/rate-limit";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const bucket = "insurance-documents";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const proposalFor: Partial<Record<PerseusDocumentClass, { type: string; title: string }>> = {
  INSURANCE_PAYMENT: { type: "REVIEW_INSURANCE_PAYMENT", title: "Revisar pagamento de convênio" },
  INVOICE: { type: "REVIEW_INVOICE", title: "Revisar nota fiscal" },
  INVOICE_REQUEST: { type: "PREPARE_INVOICE_REQUEST", title: "Preparar solicitação de nota" },
  GLOSS: { type: "REVIEW_GLOSS", title: "Revisar glosa" },
  EXPENSE: { type: "REGISTER_EXPENSE_DRAFT", title: "Preparar despesa para revisão" },
  ATTENDANCE_RELATION: { type: "LINK_ATTENDANCES", title: "Vincular atendimentos para revisão" },
};
function manager(session: Awaited<ReturnType<typeof getSession>>) { if (!session || !canManageInsurance(session.account.role)) throw new HttpError(403, "Acesso restrito à Gerência."); return session; }
function failure(error: unknown) { return Response.json({ error: error instanceof HttpError ? error.message : error instanceof Error ? error.message : "Não foi possível analisar o documento." }, { status: error instanceof HttpError ? error.status : 500, headers: { "Cache-Control": "private, no-store" } }); }

async function analyze(request: Request) {
  const session = manager(await getSession());
  await consumeLimit("perseus-global-analyze", String(session.account.id), 12, 3600);
  const id = (await readJson(request)).id;
  if (typeof id !== "string" || !uuid.test(id)) throw new HttpError(400, "Documento inválido.");
  const db = getSupabaseAdmin();
  const claim = await db.rpc("claim_perseus_document_processing", { p_document_id: id, p_actor_id: session.account.id });
  if (claim.error || !claim.data) throw new HttpError(409, claim.error?.message || "Documento indisponível para análise.");
  const document = claim.data as { id: string; storage_path: string; original_filename: string };
  try {
    const download = await db.storage.from(bucket).download(document.storage_path);
    if (download.error || !download.data) throw new HttpError(404, "Arquivo original não disponível.");
    const bytes = new Uint8Array(await download.data.arrayBuffer());
    let inspection = inspectGlobalPerseusDocument(bytes, document.original_filename);
    if (inspection.format === "PDF" || inspection.format === "PNG" || inspection.format === "JPEG" || inspection.format === "WEBP") {
      const remote = await inspectWithOpenAI(bytes, inspection.format);
      if (remote) inspection = { ...inspection, documentClass: remote.documentClass, extractedData: remote.extractedData, evidence: [...inspection.evidence, ...remote.evidence.map((item) => ({ ...item, source: { method: "MULTIMODAL" as const, version: "openai-responses-v1", snippet: item.snippet } }))], limitations: [...inspection.limitations, ...remote.limitations] };
      else inspection = { ...inspection, limitations: [...inspection.limitations, multimodalAvailability().message] };
    }
    const proposal = proposalFor[inspection.documentClass];
    const evidenceRows = inspection.evidence.map((item) => ({ document_id: id, field_key: item.field, field_value: item.value.slice(0, 1000), source_page: item.source.page || null, source_snippet: item.source.snippet?.slice(0, 1000) || null, method: item.source.method, engine_version: item.source.version }));
    if (evidenceRows.length) { const insert = await db.from("perseus_document_evidences").insert(evidenceRows); if (insert.error) throw insert.error; }
    if (proposal) { const insert = await db.from("perseus_operational_proposals").insert({ document_id: id, proposal_type: proposal.type, status: "PROPOSED", title: proposal.title, rationale: "Proposta gerada a partir de evidências do documento. Nenhuma alteração financeira foi executada.", missing_information: [] }); if (insert.error) throw insert.error; }
    const update = await db.from("perseus_documents").update({ processing_status: "REVIEW_REQUIRED", document_class: inspection.documentClass, extracted_data: inspection.extractedData, processing_metadata: { format: inspection.format, ...inspection.metadata, limitations: inspection.limitations, analyzed_at: new Date().toISOString() }, updated_at: new Date().toISOString(), updated_by: session.account.id }).eq("id", id);
    if (update.error) throw update.error;
    await db.from("perseus_global_events").insert({ document_id: id, event_type: "ANALYSIS_COMPLETED", actor_id: session.account.id, event_metadata: { format: inspection.format, class: inspection.documentClass, provider_used: inspection.evidence.some((e) => e.source.method === "MULTIMODAL") } });
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    await db.from("perseus_documents").update({ processing_status: "FAILED", error_message: error instanceof Error ? error.message.slice(0, 500) : "Falha na análise.", updated_at: new Date().toISOString(), updated_by: session.account.id }).eq("id", id);
    await db.from("perseus_global_events").insert({ document_id: id, event_type: "ANALYSIS_FAILED", actor_id: session.account.id, event_metadata: {} });
    throw error;
  }
}
export const POST = secureMutation(async (request) => { try { return await analyze(request); } catch (error) { return failure(error); } });
