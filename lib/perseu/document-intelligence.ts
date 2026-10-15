import "server-only";

import { inspectPerseusDocument } from "./inspect";

export const PERSEUS_GLOBAL_MAX_SIZE = 20 * 1024 * 1024;
export const PERSEUS_GLOBAL_LIMITS = {
  maxImagePixels: 24_000_000,
  maxTextCharacters: 250_000,
  maxPagesForProvider: 20,
} as const;

export type PerseusGlobalFormat =
  | "PDF"
  | "PNG"
  | "JPEG"
  | "WEBP"
  | "TXT"
  | "CSV"
  | "XLSX"
  | "XML";
export type PerseusDocumentClass =
  | "INSURANCE_PAYMENT"
  | "PROCESSING_RETURN"
  | "ATTENDANCE_RELATION"
  | "GUIDE"
  | "GLOSS"
  | "TRANSFER_PROOF"
  | "INVOICE"
  | "INVOICE_REQUEST"
  | "EXPENSE"
  | "UNKNOWN"
  | "MULTIPLE";
export type Evidence = {
  field: string;
  value: string;
  source: { page?: number; snippet?: string; method: "LOCAL_TEXT" | "STRUCTURAL" | "MULTIMODAL"; version: string };
};
export type GlobalInspection = {
  format: PerseusGlobalFormat;
  documentClass: PerseusDocumentClass;
  extractedData: Record<string, string>;
  evidence: Evidence[];
  limitations: string[];
  metadata: Record<string, unknown>;
};

const text = (bytes: Uint8Array) => new TextDecoder("utf-8", { fatal: false }).decode(bytes);
const starts = (bytes: Uint8Array, values: number[]) => values.every((value, index) => bytes[index] === value);

export function detectPerseusGlobalFormat(bytes: Uint8Array, filename = ""): PerseusGlobalFormat | null {
  const lower = filename.toLowerCase();
  if (text(bytes.slice(0, 5)) === "%PDF-") return "PDF";
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "PNG";
  if (starts(bytes, [0xff, 0xd8, 0xff])) return "JPEG";
  if (text(bytes.slice(0, 4)) === "RIFF" && text(bytes.slice(8, 12)) === "WEBP") return "WEBP";
  if (/\.xlsx$/i.test(lower) && starts(bytes, [0x50, 0x4b])) return "XLSX";
  const sample = text(bytes.slice(0, 4096)).trimStart();
  if (/\.xml$/i.test(lower) && /^<\?xml|^<[^>]+>/.test(sample)) return "XML";
  if (/\.csv$/i.test(lower) && /[,;\t]/.test(sample)) return "CSV";
  if (/\.txt$/i.test(lower) && !/[\x00-\x08\x0e-\x1f]/.test(sample)) return "TXT";
  return null;
}

export function classifyPerseusText(value: string): PerseusDocumentClass {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
  if (/glosa|glosado/.test(normalized)) return "GLOSS";
  if (/nota fiscal|nf-e|nfe\b/.test(normalized)) return "INVOICE";
  if (/solicitacao.*nota|pedido.*nota/.test(normalized)) return "INVOICE_REQUEST";
  if (/despesa|boleto|conta a pagar/.test(normalized)) return "EXPENSE";
  if (/comprovante|pix|ted|transferencia/.test(normalized)) return "TRANSFER_PROOF";
  if (/guia/.test(normalized)) return "GUIDE";
  if (/demonstrativo|processamento|lote/.test(normalized)) return "PROCESSING_RETURN";
  if (/convenio|operadora|pagador/.test(normalized)) return "INSURANCE_PAYMENT";
  if (/paciente|atendimento|procedimento/.test(normalized)) return "ATTENDANCE_RELATION";
  return "UNKNOWN";
}

function extractPdfText(bytes: Uint8Array) {
  // Conservative extraction of literal text operators. Scanned PDFs intentionally
  // remain unclassified locally and can only be sent to the configured provider.
  const source = new TextDecoder("latin1").decode(bytes);
  return [...source.matchAll(/\(([^()]{1,500})\)\s*Tj/g)]
    .map((match) => match[1].replace(/\\([()\\])/g, "$1"))
    .join(" ")
    .slice(0, PERSEUS_GLOBAL_LIMITS.maxTextCharacters);
}

export function inspectGlobalPerseusDocument(bytes: Uint8Array, filename: string): GlobalInspection {
  const format = detectPerseusGlobalFormat(bytes, filename);
  if (!format) throw new Error("O tipo real do arquivo não é suportado pelo Perseu.");
  if (format === "CSV" || format === "XLSX" || format === "XML") {
    const structural = inspectPerseusDocument(format, bytes);
    if (structural.kind === "unsupported") throw new Error(structural.message);
    const headings = structural.result.structure.columns?.map((column) => column.original).join(" ") || "";
    return {
      format,
      documentClass: classifyPerseusText(headings),
      extractedData: {},
      evidence: headings ? [{ field: "structure", value: headings.slice(0, 240), source: { method: "STRUCTURAL", version: structural.result.parserVersion } }] : [],
      limitations: structural.result.warnings,
      metadata: { parser_key: structural.result.parserKey, parser_version: structural.result.parserVersion, layout_fingerprint: structural.result.layoutFingerprint, row_count: structural.result.structure.rowCount, column_count: structural.result.structure.columnCount, sheet_count: structural.result.structure.sheetCount },
    };
  }
  if (format === "PDF") {
    const extracted = extractPdfText(bytes);
    return { format, documentClass: classifyPerseusText(extracted), extractedData: {}, evidence: extracted ? [{ field: "document_text", value: extracted.slice(0, 240), source: { method: "LOCAL_TEXT", version: "1.0.0", snippet: extracted.slice(0, 240) } }] : [], limitations: extracted ? [] : ["PDF sem texto selecionável: análise multimodal depende de configuração explícita."], metadata: { text_characters: extracted.length } };
  }
  if (format === "TXT") {
    const extracted = text(bytes).slice(0, PERSEUS_GLOBAL_LIMITS.maxTextCharacters);
    return { format, documentClass: classifyPerseusText(extracted), extractedData: {}, evidence: extracted ? [{ field: "document_text", value: extracted.slice(0, 240), source: { method: "LOCAL_TEXT", version: "1.0.0", snippet: extracted.slice(0, 240) } }] : [], limitations: [], metadata: { text_characters: extracted.length } };
  }
  return { format, documentClass: "UNKNOWN", extractedData: {}, evidence: [], limitations: ["Imagem validada. A interpretação requer provedor multimodal configurado e consentido."], metadata: {} };
}
