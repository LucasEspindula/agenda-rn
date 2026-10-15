export const PERSEUS_EVENT_TYPES = [
  "DOCUMENT_IMPORTED",
  "IMPORT_REJECTED",
  "FORMAT_UNSUPPORTED",
  "ANALYSIS_COMPLETED",
  "STRUCTURE_IDENTIFIED",
  "SEMANTIC_INTERPRETATION_COMPLETED",
  "SEMANTIC_CONFLICT_IDENTIFIED",
  "LEARNED_SUGGESTION_REUSED",
  "MAPPING_REVIEW_APPLIED",
  "MAPPING_REVIEW_REJECTED",
  "MAPPING_REVIEW_REPLACED",
  "LEARNED_RULE_CREATED",
  "LEARNED_RULE_REUSED",
  "LEARNED_RULE_REVOKED",
  "INDIVIDUAL_CORRECTION_APPLIED",
  "REANALYSIS_BLOCKED",
  "ANALYSIS_FAILED",
] as const;

export type PerseusEventType = (typeof PERSEUS_EVENT_TYPES)[number];
export type PerseusEventOrigin =
  | "SYSTEM"
  | "SEMANTIC_ENGINE"
  | "LEARNED_KNOWLEDGE"
  | "USER"
  | "HISTORICAL_RECONSTRUCTED";

export type PerseusDocumentEvent = {
  id: string;
  documentId: string;
  eventType: PerseusEventType;
  eventOrigin: PerseusEventOrigin;
  occurredAt: string;
  actorId: number | null;
  actorName?: string;
  parserVersion?: string | null;
  semanticVersion?: string | null;
  relatedReviewId?: string | null;
  relatedRuleId?: string | null;
  relatedCorrectionId?: string | null;
  metadata: Record<string, unknown>;
  historical?: boolean;
};

const safeText = (value: unknown, maximum = 80) =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, maximum)
    : "";

/** Event metadata intentionally excludes raw document cells, patients and amounts. */
export function safePerseusEventMetadata(value: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (["column", "field", "reason", "format"].includes(key)) {
      const text = safeText(item);
      if (text) next[key] = text;
    }
    if (["items", "tables", "columns", "records"].includes(key)) {
      const number = Number(item);
      if (Number.isInteger(number) && number >= 0 && number <= 2000)
        next[key] = number;
    }
  }
  return next;
}

export const perseusEventPresentation = (event: PerseusDocumentEvent) => {
  const metadata = event.metadata || {};
  const field = safeText(metadata.field);
  const column = safeText(metadata.column);
  const count = (key: string) => Number(metadata[key] || 0);
  const mapping = column && field ? `“${column}” → “${field}”.` : "";
  const details: Partial<Record<PerseusEventType, [string, string]>> = {
    DOCUMENT_IMPORTED: ["Documento importado", "Documento pronto para análise."],
    IMPORT_REJECTED: ["Importação rejeitada", "A importação foi encerrada com segurança."],
    FORMAT_UNSUPPORTED: ["Formato ainda não analisado", "O arquivo foi preservado; o Perseu ainda não possui parser para este formato."],
    ANALYSIS_COMPLETED: ["Análise estrutural concluída", `${count("tables")} estrutura(s) identificada(s).`],
    STRUCTURE_IDENTIFIED: ["Estrutura identificada", `${count("tables")} tabela(s) · ${count("columns")} coluna(s) · ${count("records")} registro(s).`],
    SEMANTIC_INTERPRETATION_COMPLETED: ["Interpretação semântica concluída", `${count("items")} campo(s) reconhecido(s) pelo motor.`],
    SEMANTIC_CONFLICT_IDENTIFIED: ["Conflito semântico identificado", "A interpretação foi mantida para revisão humana."],
    LEARNED_SUGGESTION_REUSED: ["Sugestão aprendida reutilizada", mapping || "Uma regra compatível foi sugerida neste documento."],
    MAPPING_REVIEW_APPLIED: ["Mapeamento confirmado", mapping || "Mapeamento confirmado somente neste documento."],
    MAPPING_REVIEW_REJECTED: ["Mapeamento rejeitado", column ? `“${column}” foi mantida sem significado semântico.` : "Mapeamento mantido sem significado semântico."],
    MAPPING_REVIEW_REPLACED: ["Revisão substituída", mapping || "Uma revisão anterior foi preservada e substituída."],
    LEARNED_RULE_CREATED: ["Regra aprendida criada", mapping || "O mapeamento poderá ser sugerido em estruturas e contextos compatíveis."],
    LEARNED_RULE_REUSED: ["Regra aprendida reutilizada", mapping || "Uma regra equivalente já estava ativa."],
    LEARNED_RULE_REVOKED: ["Regra aprendida revogada", "A regra foi preservada no histórico e não será aplicada novamente."],
    INDIVIDUAL_CORRECTION_APPLIED: ["Correção individual aplicada", field ? `“${field}” foi corrigido em um registro da estrutura.` : "Um valor semântico foi corrigido em um registro da estrutura."],
    REANALYSIS_BLOCKED: ["Reanálise bloqueada", "A proteção de revisão humana ou vínculo preservou os dados atuais."],
    ANALYSIS_FAILED: ["Falha de processamento", "A análise não foi concluída; o documento original foi preservado."],
  };
  const [title, detail] = details[event.eventType] || ["Operação do Perseu", "Operação registrada."];
  return { title, detail };
};

export const perseusOriginLabel = (origin: string | undefined) =>
  ({
    HEURISTIC: "Motor semântico",
    LEARNED_SUGGESTION: "Aprendido anteriormente",
    USER_CONFIRMED: "Confirmado pelo usuário neste documento",
    USER_REJECTED: "Rejeitado pelo usuário neste documento",
    CONFLICT: "Conflito de conhecimento",
  })[origin || ""] || "Motor semântico";
