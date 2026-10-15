import { createHash } from "node:crypto";
import { getSession } from "@/app/authz";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { canManageInsurance } from "@/lib/insurance-control";
import { detectPerseusGlobalFormat, PERSEUS_GLOBAL_MAX_SIZE } from "@/lib/perseu/document-intelligence";
import { HttpError, readJson, secureMutation } from "@/lib/security/http";
import { consumeLimit } from "@/lib/security/rate-limit";
import sharp from "sharp";

const BUCKET = "insurance-documents";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function manager(session: Awaited<ReturnType<typeof getSession>>) { if (!session || !canManageInsurance(session.account.role)) throw new HttpError(403, "Acesso restrito à Gerência."); return session; }
function name(value: unknown) { return typeof value === "string" && value === value.trim() && value.length > 0 && value.length <= 200 && !/[\\/\x00-\x1f]/.test(value) ? value : null; }
const fail = (error: unknown) => Response.json({ error: error instanceof HttpError ? error.message : "Não foi possível processar o documento." }, { status: error instanceof HttpError ? error.status : 500, headers: { "Cache-Control": "private, no-store" } });

export async function GET() {
  try {
    manager(await getSession());
    const db = getSupabaseAdmin();
    const { data, error } = await db.from("perseus_documents").select("id,original_filename,mime_type,file_size,detected_format,processing_status,document_class,extracted_data,processing_metadata,error_message,created_at,perseus_operational_proposals(id,proposal_type,status,title,rationale,missing_information)").order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    return Response.json({ documents: data || [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return fail(error); }
}
export const POST = secureMutation(async (request) => {
  try {
    const session = manager(await getSession()); await consumeLimit("perseus-global-upload", String(session.account.id), 30, 3600);
    const body = await readJson(request), filename = name(body.name), size = body.size, mime = typeof body.mimeType === "string" ? body.mimeType.slice(0, 120) : "application/octet-stream";
    if (!filename || !Number.isInteger(size) || size <= 0 || size > PERSEUS_GLOBAL_MAX_SIZE) throw new HttpError(400, "Selecione um arquivo válido de até 20 MB.");
    const db = getSupabaseAdmin(), id = crypto.randomUUID(), path = "perseus/global/" + id;
    const insert = await db.from("perseus_documents").insert({ id, storage_path: path, original_filename: filename, mime_type: mime, file_size: size, created_by: session.account.id, updated_by: session.account.id }).select("id,storage_path").single();
    if (insert.error) throw insert.error;
    const signed = await db.storage.from(BUCKET).createSignedUploadUrl(path, { upsert: false });
    if (signed.error || !signed.data) throw new HttpError(503, "Não foi possível preparar o envio.");
    return Response.json({ id, url: signed.data.signedUrl }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return fail(error); }
});
export const PATCH = secureMutation(async (request) => {
  try {
    const session = manager(await getSession()); await consumeLimit("perseus-global-finalize", String(session.account.id), 40, 3600);
    const body = await readJson(request), id = typeof body.id === "string" ? body.id : "";
    if (!uuid.test(id)) throw new HttpError(400, "Documento inválido.");
    const db = getSupabaseAdmin(), doc = await db.from("perseus_documents").select("id,storage_path,original_filename,file_size,created_by,processing_status").eq("id", id).maybeSingle();
    if (doc.error) throw doc.error;
    if (!doc.data || doc.data.created_by !== session.account.id || doc.data.processing_status !== "RECEIVED") throw new HttpError(403, "Envio não disponível.");
    const file = await db.storage.from(BUCKET).download(doc.data.storage_path);
    if (file.error || !file.data) throw new HttpError(409, "O envio ainda não terminou.");
    const bytes = new Uint8Array(await file.data.arrayBuffer()), format = detectPerseusGlobalFormat(bytes, doc.data.original_filename);
    if (bytes.byteLength !== doc.data.file_size || !format) throw new HttpError(400, "Formato ou conteúdo do arquivo inválido.");
    if (format === "PNG" || format === "JPEG" || format === "WEBP") {
      const metadata = await sharp(bytes, { limitInputPixels: 24_000_000 }).metadata();
      if (!metadata.width || !metadata.height || metadata.width * metadata.height > 24_000_000) throw new HttpError(400, "A imagem excede os limites aceitos pelo Perseu.");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const duplicate = await db.from("perseus_documents").select("id").eq("sha256", sha256).neq("id", id).neq("processing_status", "FAILED").maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) throw new HttpError(409, "Este documento já foi recebido pelo Perseu.");
    const update = await db.from("perseus_documents").update({ sha256, detected_format: format, mime_type: file.data.type || "application/octet-stream", processing_status: "PENDING_PROCESSING", updated_at: new Date().toISOString(), updated_by: session.account.id }).eq("id", id);
    if (update.error) throw update.error;
    await db.from("perseus_global_events").insert({ document_id: id, event_type: "DOCUMENT_RECEIVED", actor_id: session.account.id, event_metadata: { format } });
    return Response.json({ ok: true, format }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return fail(error); }
});
