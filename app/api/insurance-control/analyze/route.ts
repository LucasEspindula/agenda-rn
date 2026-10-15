import { getSession } from "@/app/authz";
import { canManageInsurance } from "@/lib/insurance-control";
import { inspectPerseusDocument } from "@/lib/perseu/inspect";
import {
  PerseusParseError,
  type PerseusParseResult,
} from "@/lib/perseu/contracts";
import { perseusItemRows } from "@/lib/perseu/persistence";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { consumeLimit } from "@/lib/security/rate-limit";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";
import { normalizeInsurancePayer } from "@/lib/insurance-control";
import { interpretPerseusSemantics } from "@/lib/perseu/semantic/detect";
import type { PerseusSemanticRule } from "@/lib/perseu/supervision/contracts";
import { adaptSupabaseSemanticRule } from "@/lib/perseu/supervision/rules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "insurance-documents";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;
type Document = {
  id: string;
  storage_path: string;
  detected_format: string | null;
  upload_status: string;
  raw_metadata: Record<string, unknown> | null;
  updated_at: string;
  movement: { billing_entity_id: string; payer: string; kind: string };
};

function manager(
  session: Awaited<ReturnType<typeof getSession>>,
): asserts session is Session {
  if (!session || !canManageInsurance(session.account.role))
    throw new HttpError(403, "Acesso restrito à Gerência.");
}
function id(value: unknown) {
  return typeof value === "string" && uuid.test(value);
}
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof HttpError || error instanceof PerseusParseError
          ? error.message
          : "Não foi possível analisar o documento.",
    },
    {
      status: error instanceof HttpError ? error.status : 500,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
async function documentFor(documentId: string) {
  const result = await getSupabaseAdmin()
    .from("insurance_documents")
    .select("id,storage_path,detected_format,upload_status,raw_metadata,updated_at,movement:insurance_movements!inner(billing_entity_id,payer,kind)")
    .eq("id", documentId)
    .maybeSingle();
  if (result.error) throw result.error;
  return result.data as Document | null;
}
function metadata(result: PerseusParseResult) {
  return {
    parsed_at: new Date().toISOString(),
    parser_key: result.parserKey,
    parser_version: result.parserVersion,
    format: result.format,
    row_count: result.structure.rowCount,
    column_count: result.structure.columnCount,
    sheet_count: result.structure.sheetCount,
    layout_fingerprint: result.layoutFingerprint,
    fingerprint_version: result.structure.fingerprintVersion || 1,
    warnings: result.warnings,
    semantic: result.semantic
      ? { version: result.semantic.version, tables: result.semantic.tables }
      : undefined,
    structure: {
      sheets: result.structure.sheets?.map((sheet) => ({
        name: sheet.name,
        columns: sheet.columns,
      })),
      tables: result.structure.tables?.map((table) => ({
        table_id: table.tableId,
        source: table.source,
        region: table.region,
        header_location: table.headerLocation,
        columns: table.columns,
        record_count: table.recordCount,
        detection_evidence: table.detectionEvidence,
        warnings: table.warnings,
      })),
    },
  };
}
async function replaceItems(
  document: Document,
  result: PerseusParseResult,
  actorId: number,
) {
  const replace = await getSupabaseAdmin().rpc(
    "replace_perseus_document_analysis",
    {
      p_document_id: document.id,
      p_items: perseusItemRows(result),
      p_parser_key: result.parserKey,
      p_parser_version: result.parserVersion,
      p_perseus_metadata: metadata(result),
      p_updated_by: actorId,
    },
  );
  if (replace.error) throw replace.error;
}

async function fail(document: Document, actorId: number, message: string) {
  const rawMetadata = {
    ...(document.raw_metadata || {}),
    perseus: {
      ...((document.raw_metadata?.perseus as
        Record<string, unknown> | undefined) || {}),
      failed_at: new Date().toISOString(),
      error: message,
    },
  };
  const result = await getSupabaseAdmin()
    .from("insurance_documents")
    .update({
      perseus_status: "FAILED",
      raw_metadata: rawMetadata,
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    })
    .eq("id", document.id)
    .eq("upload_status", "READY");
  if (result.error) throw result.error;
}

async function analyze(request: Request) {
  const session = await getSession();
  manager(session);
  await consumeLimit("perseus-analyze", String(session.account.id), 15, 3600);
  const body = await readJson(request),
    documentId = body.id;
  if (!id(documentId)) throw new HttpError(400, "Documento inválido.");
  const document = await documentFor(documentId);
  if (!document || document.upload_status !== "READY")
    throw new HttpError(
      409,
      "Somente documentos prontos podem ser analisados.",
    );
  const download = await getSupabaseAdmin()
    .storage.from(BUCKET)
    .download(document.storage_path);
  if (download.error || !download.data)
    throw new HttpError(404, "Arquivo original não disponível.");
  try {
    const inspection = inspectPerseusDocument(
      document.detected_format,
      new Uint8Array(await download.data.arrayBuffer()),
    );
    if (inspection.kind === "unsupported")
      return Response.json(
        { ok: false, unsupported: true, message: inspection.message },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    const rules = await getSupabaseAdmin()
      .from("perseus_semantic_rules")
      .select("id,domain,billing_entity_id,payer_normalized,movement_kind,layout_fingerprint,table_signature,column_normalized,semantic_field,state,version")
      .eq("state", "ACTIVE")
      .eq("domain", "INSURANCE")
      .eq("billing_entity_id", document.movement.billing_entity_id)
      .eq("payer_normalized", normalizeInsurancePayer(document.movement.payer))
      .eq("movement_kind", document.movement.kind);
    if (rules.error) throw rules.error;
    const learned = interpretPerseusSemantics(inspection.result, {
      context: {
        domain: "INSURANCE",
        billingEntityId: document.movement.billing_entity_id,
        payerNormalized: normalizeInsurancePayer(document.movement.payer),
        movementKind: document.movement.kind,
        layoutFingerprint: inspection.result.layoutFingerprint,
      },
      rules: (rules.data || [])
        .map(adaptSupabaseSemanticRule)
        .filter((rule: PerseusSemanticRule | null): rule is PerseusSemanticRule => rule !== null),
    });
    await replaceItems(document, learned, session.account.id);
    return Response.json(
      { ok: true, summary: metadata(learned) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    if (error instanceof PerseusParseError) {
      await fail(document, session.account.id, error.message);
      return Response.json(
        { error: error.message },
        { status: 422, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    manager(session);
    const url = new URL(request.url),
      documentId = url.searchParams.get("id");
    if (typeof documentId !== "string" || !id(documentId))
      throw new HttpError(400, "Documento inválido.");
    const document = await documentFor(documentId);
    if (!document || document.upload_status !== "READY")
      throw new HttpError(404, "Documento não disponível.");
    const limit = Math.min(
        Math.max(Number(url.searchParams.get("limit") || 20) || 20, 1),
        20,
      ),
      items = await getSupabaseAdmin()
        .from("insurance_document_items")
        .select(
          "id,source_index,raw_data,normalized_data,match_evidence,source_metadata",
        )
        .eq("document_id", document.id)
        .order("source_index", { ascending: true })
        .limit(limit),
      reviews = await getSupabaseAdmin()
        .from("perseus_semantic_reviews")
        .select("table_id,source_key,semantic_field,state,created_at")
        .eq("document_id", document.id)
        .in("state", ["CONFIRMED", "REJECTED"]);
    if (items.error) throw items.error;
    if (reviews.error) throw reviews.error;
    const perseus = (
      document.raw_metadata?.perseus &&
      typeof document.raw_metadata.perseus === "object"
        ? document.raw_metadata.perseus
        : {}
    ) as Record<string, unknown>;
    const summary = structuredClone(perseus) as Record<string, unknown>;
    const semantic = summary.semantic as { tables?: { tableId: string; columns?: Record<string, unknown>[] }[] } | undefined;
    for (const review of reviews.data || []) {
      const table = semantic?.tables?.find((candidate) => candidate.tableId === review.table_id);
      const column = table?.columns?.find((candidate) => candidate.sourceKey === review.source_key);
      if (!column) continue;
      column.field = review.semantic_field;
      column.classification = review.state === "CONFIRMED" ? "HIGH" : "UNKNOWN";
      column.origin = review.state === "CONFIRMED" ? "USER_CONFIRMED" : "USER_REJECTED";
      column.reasons = ["Revisado por usuário."];
      column.warnings = [];
    }
    return Response.json(
      {
        summary,
        updatedAt: document.updated_at,
        items: (
          (items.data || []) as {
            id: string;
            source_index: number;
            raw_data: Record<string, unknown>;
            normalized_data: Record<string, unknown>;
            match_evidence: Record<string, unknown>;
            source_metadata: Record<string, unknown>;
          }[]
        ).map((item) => ({
          id: item.id,
          sourceIndex: item.source_index,
          rawData: item.raw_data,
          normalizedData: item.normalized_data,
          semanticEvidence: item.match_evidence,
          sourceMetadata: item.source_metadata,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export const POST = secureMutation(async (request) => {
  try {
    return await analyze(request);
  } catch (error) {
    return failure(error);
  }
});
