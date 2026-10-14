import type { PerseusSemanticField } from "../semantic/contracts";

/** Contexto mínimo que impede uma regra aprendida de vazar para outro layout. */
export type PerseusRuleContext = {
  domain: "INSURANCE";
  billingEntityId: string;
  payerNormalized: string;
  movementKind: string;
  layoutFingerprint: string;
  tableSignature: string;
};

export type PerseusSemanticOrigin =
  | "HEURISTIC"
  | "LEARNED_SUGGESTION"
  | "USER_CONFIRMED"
  | "USER_REJECTED"
  | "CONFLICT";

export type PerseusSemanticRule = PerseusRuleContext & {
  id: string;
  columnNormalized: string;
  semanticField: PerseusSemanticField | null;
  state: "ACTIVE" | "REVOKED" | "SUPERSEDED";
  version: number;
};

export type PerseusMappingReviewInput = {
  documentId: string;
  tableId: string;
  sourceKey: string;
  semanticField: PerseusSemanticField | null;
  learn: boolean;
  expectedUpdatedAt: string;
};

export type PerseusValueCorrectionInput = {
  documentId: string;
  itemId: string;
  semanticField: PerseusSemanticField;
  value: unknown;
  expectedUpdatedAt: string;
};
