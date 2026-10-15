import { getSession } from "@/app/authz";
import { canManageInsurance } from "@/lib/insurance-control";
import {
  type PerseusDocumentEvent,
  safePerseusEventMetadata,
} from "@/lib/perseu/operational-history";
import {
  decodePerseusTimelineCursor,
  paginatePerseusTimeline,
  reconstructPerseusLegacyReviews,
} from "@/lib/perseu/operational-timeline";
import { HttpError } from "@/lib/security/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const bounded = (value: string | null, fallback: number, maximum: number) =>
  Math.min(Math.max(Number(value) || fallback, 1), maximum);
type User = { id: number; name: string | null; email: string | null };
type Row = Record<string, unknown>;

function manager(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session || !canManageInsurance(session.account.role))
    throw new HttpError(403, "Acesso restrito à Gerência.");
}
function failure(error: unknown) {
  const message = error instanceof HttpError ? error.message : "Não foi possível carregar o histórico do Perseu.";
  return Response.json({ error: message }, { status: error instanceof HttpError ? error.status : 500, headers: { "Cache-Control": "private, no-store" } });
}
function persistedEvent(row: Row): PerseusDocumentEvent {
  return {
    id: String(row.id), documentId: String(row.document_id), eventType: row.event_type as PerseusDocumentEvent["eventType"], eventOrigin: row.event_origin as PerseusDocumentEvent["eventOrigin"],
    occurredAt: String(row.occurred_at), actorId: typeof row.actor_id === "number" ? row.actor_id : null,
    parserVersion: typeof row.parser_version === "string" ? row.parser_version : null,
    semanticVersion: typeof row.semantic_version === "string" ? row.semantic_version : null,
    relatedReviewId: typeof row.related_review_id === "string" ? row.related_review_id : null,
    relatedRuleId: typeof row.related_rule_id === "string" ? row.related_rule_id : null,
    relatedCorrectionId: typeof row.related_correction_id === "string" ? row.related_correction_id : null,
    metadata: safePerseusEventMetadata((row.event_metadata || {}) as Record<string, unknown>),
  };
}

export async function GET(request: Request) {
  try {
    manager(await getSession());
    const url = new URL(request.url);
    const documentId = url.searchParams.get("id") || "";
    if (!uuid.test(documentId)) throw new HttpError(400, "Documento inválido.");
    const limit = bounded(url.searchParams.get("limit"), 20, 50);
    const cursor = decodePerseusTimelineCursor(url.searchParams.get("cursor"));
    if (url.searchParams.get("cursor") && !cursor)
      throw new HttpError(400, "Cursor do histórico inválido.");
    const db = getSupabaseAdmin();
    const document = await db.from("insurance_documents").select("id").eq("id", documentId).maybeSingle();
    if (document.error) throw document.error;
    if (!document.data) throw new HttpError(404, "Documento não encontrado.");

    const [events, reviews, corrections, rules] = await Promise.all([
      db.from("perseus_document_events").select("id,document_id,event_type,event_origin,occurred_at,actor_id,parser_version,semantic_version,related_review_id,related_rule_id,related_correction_id,event_metadata").eq("document_id", documentId).order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(5000),
      db.from("perseus_semantic_reviews").select("id,source_key,semantic_field,state,created_at,created_by").eq("document_id", documentId).order("created_at", { ascending: false }).limit(5000),
      db.from("perseus_semantic_value_corrections").select("id,semantic_field,state,created_at,created_by").eq("document_id", documentId).order("created_at", { ascending: false }).limit(5000),
      db.from("perseus_semantic_rules").select("id,column_normalized,semantic_field,state,created_at,created_by,revoked_at,revoked_by").eq("source_document_id", documentId).order("created_at", { ascending: false }).limit(5000),
    ]);
    const ledgerUnavailable = events.error?.code === "42P01";
    if (events.error && !ledgerUnavailable) throw events.error;
    for (const result of [reviews, corrections, rules]) if (result.error) throw result.error;
    const persisted = ledgerUnavailable ? [] : ((events.data || []) as Row[]).map(persistedEvent);
    const ruleKeys = new Set(persisted.filter((event) => event.relatedRuleId).map((event) => "rule:" + event.relatedRuleId + ":" + event.eventType));
    const correctionKeys = new Set(persisted.filter((event) => event.relatedCorrectionId).map((event) => "correction:" + event.relatedCorrectionId + ":" + event.eventType));
    const legacy: PerseusDocumentEvent[] = [
      ...reconstructPerseusLegacyReviews(documentId, (reviews.data || []) as Row[], persisted),
      ...((corrections.data || []) as Row[]).flatMap((row) => correctionKeys.has("correction:" + row.id + ":INDIVIDUAL_CORRECTION_APPLIED") ? [] : [{ id: "legacy-correction-" + row.id, documentId, eventType: "INDIVIDUAL_CORRECTION_APPLIED", eventOrigin: "HISTORICAL_RECONSTRUCTED", occurredAt: String(row.created_at), actorId: typeof row.created_by === "number" ? row.created_by : null, metadata: safePerseusEventMetadata({ field: row.semantic_field }), historical: true } as PerseusDocumentEvent]),
      ...((rules.data || []) as Row[]).flatMap((row) => {
        const created = ruleKeys.has("rule:" + row.id + ":LEARNED_RULE_CREATED") ? [] : [{ id: "legacy-rule-" + row.id, documentId, eventType: "LEARNED_RULE_CREATED" as const, eventOrigin: "HISTORICAL_RECONSTRUCTED" as const, occurredAt: String(row.created_at), actorId: typeof row.created_by === "number" ? row.created_by : null, metadata: safePerseusEventMetadata({ column: row.column_normalized, field: row.semantic_field }), historical: true }];
        const revoked = row.state === "REVOKED" && row.revoked_at && !ruleKeys.has("rule:" + row.id + ":LEARNED_RULE_REVOKED") ? [{ id: "legacy-rule-revoked-" + row.id, documentId, eventType: "LEARNED_RULE_REVOKED" as const, eventOrigin: "HISTORICAL_RECONSTRUCTED" as const, occurredAt: String(row.revoked_at), actorId: typeof row.revoked_by === "number" ? row.revoked_by : null, metadata: safePerseusEventMetadata({ column: row.column_normalized, field: row.semantic_field }), historical: true }] : [];
        return [...created, ...revoked] as PerseusDocumentEvent[];
      }),
    ];
    const page = paginatePerseusTimeline([...persisted, ...legacy], limit, cursor);
    const actorIds = [...new Set(page.events.map((event) => event.actorId).filter((id): id is number => id !== null))];
    const users = actorIds.length ? await db.from("users").select("id,name,email").in("id", actorIds) : { data: [], error: null };
    if (users.error) throw users.error;
    const names = new Map(((users.data || []) as User[]).map((user) => [user.id, user.name || user.email || "Gerência"]));
    return Response.json({
      ...page,
      availability: ledgerUnavailable ? "MIGRATION_PENDING" : "READY",
      events: page.events.map((event) => ({ ...event, actorName: event.actorId === null ? undefined : names.get(event.actorId) || "Gerência" })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
