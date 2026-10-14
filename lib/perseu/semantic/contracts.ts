export const PERSEUS_SEMANTIC_VERSION = "1.0.0";

export const SEMANTIC_FIELDS = [
  "patient_name",
  "beneficiary_number",
  "guide_number",
  "external_reference",
  "service_date",
  "procedure_code",
  "procedure_description",
  "amount_presented",
  "amount_approved",
  "amount_glossed",
  "gloss_code",
  "gloss_reason",
] as const;

export type PerseusSemanticField = (typeof SEMANTIC_FIELDS)[number];
export type SemanticClassification =
  "HIGH" | "MEDIUM" | "AMBIGUOUS" | "UNKNOWN";

export type SemanticEvidence = {
  sourceColumn: string;
  sourceKey: string;
  tableId: string;
  classification: SemanticClassification;
  reasons: string[];
  warnings: string[];
};

export type SemanticColumnInterpretation = SemanticEvidence & {
  field: PerseusSemanticField | null;
};

export type PerseusSemanticTable = {
  tableId: string;
  columns: SemanticColumnInterpretation[];
  warnings: string[];
};

export type PerseusSemanticResult = {
  version: string;
  tables: PerseusSemanticTable[];
};

export type PerseusNormalizedData = Partial<
  Record<PerseusSemanticField, string>
>;
