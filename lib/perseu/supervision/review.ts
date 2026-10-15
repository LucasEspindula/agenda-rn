import type { PerseusRawItem } from "../contracts";
import type { PerseusSemanticField } from "../semantic/contracts";
import {
  normalizeAmount,
  normalizeDate,
  normalizeIdentifier,
  normalizeSemanticText,
} from "../semantic/normalize";

const identifierFields = new Set<PerseusSemanticField>([
  "guide_number", "beneficiary_number", "procedure_code", "gloss_code",
]);
const amountFields = new Set<PerseusSemanticField>([
  "amount_presented", "amount_approved", "amount_glossed",
]);

export function normalizeSemanticReviewValue(field: PerseusSemanticField, value: unknown) {
  if (field === "service_date") return normalizeDate(value).value;
  if (amountFields.has(field)) return normalizeAmount(value).value;
  if (identifierFields.has(field)) return normalizeIdentifier(value);
  return normalizeSemanticText(value);
}

type ExistingEvidence = Record<string, unknown> & { sourceKey?: string; origin?: string };
export type PerseusReviewItemUpdate = {
  id: string;
  normalizedData: Record<string, string>;
  semanticEvidence: Record<string, unknown>;
  typed: Partial<Record<PerseusSemanticField, string>>;
};

/** Applies a human mapping only to values that came from the selected source column. */
export function projectSemanticReview(
  items: Array<{ id: string; rawData: Record<string, unknown>; normalizedData: Record<string, string>; semanticEvidence: Record<string, unknown> }>,
  sourceKey: string,
  field: PerseusSemanticField | null,
): PerseusReviewItemUpdate[] {
  return items.map((item) => {
    const normalizedData = { ...item.normalizedData };
    const semanticEvidence = { ...item.semanticEvidence };
    for (const [key, evidence] of Object.entries(semanticEvidence)) {
      if ((evidence as ExistingEvidence)?.sourceKey === sourceKey) {
        delete semanticEvidence[key];
        delete normalizedData[key];
      }
    }
    if (field) {
      const value = normalizeSemanticReviewValue(field, item.rawData[sourceKey]);
      if (value) {
        normalizedData[field] = value;
      }
      semanticEvidence[field] = {
        sourceKey,
        field,
        classification: "HIGH",
        origin: "USER_CONFIRMED",
        reasons: ["Mapeamento confirmado por revisão humana."],
        warnings: value ? [] : ["Valor original não passou na normalização segura."],
      };
    }
    const typed: Partial<Record<PerseusSemanticField, string>> = { ...normalizedData };
    return { id: item.id, normalizedData, semanticEvidence, typed };
  });
}

export function hasHumanValueCorrection(item: PerseusRawItem) {
  return Object.values(item.semanticEvidence || {}).some(
    (value) => (value as ExistingEvidence)?.origin === "USER_CONFIRMED" && (value as ExistingEvidence)?.corrected === true,
  );
}
