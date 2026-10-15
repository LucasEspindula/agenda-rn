import type { PerseusTable } from "../contracts";
import type { PerseusSemanticField } from "../semantic/contracts";
import type { PerseusRuleContext, PerseusSemanticRule } from "./contracts";

type SupabaseRuleRow = {
  id: unknown; domain: unknown; billing_entity_id: unknown; payer_normalized: unknown;
  movement_kind: unknown; layout_fingerprint: unknown; table_signature: unknown;
  column_normalized: unknown; semantic_field: unknown; state: unknown; version: unknown;
};
const text = (value: unknown) => typeof value === "string" && value.length ? value : null;

/** Runtime adapter: a TypeScript cast never renames snake_case database columns. */
export function adaptSupabaseSemanticRule(row: SupabaseRuleRow): PerseusSemanticRule | null {
  const id=text(row.id), domain=text(row.domain), billingEntityId=text(row.billing_entity_id), payerNormalized=text(row.payer_normalized), movementKind=text(row.movement_kind), layoutFingerprint=text(row.layout_fingerprint), tableSignature=text(row.table_signature), columnNormalized=text(row.column_normalized), state=text(row.state);
  const semanticField=row.semantic_field===null?null:text(row.semantic_field);
  if (!id || domain !== "INSURANCE" || !billingEntityId || !payerNormalized || !movementKind || !layoutFingerprint || !tableSignature || !columnNormalized || !state || !["ACTIVE","REVOKED","SUPERSEDED"].includes(state) || (semanticField !== null && !["patient_name","beneficiary_number","guide_number","external_reference","service_date","procedure_code","procedure_description","amount_presented","amount_approved","amount_glossed","gloss_code","gloss_reason"].includes(semanticField)) || !Number.isInteger(row.version)) return null;
  return { id, domain, billingEntityId, payerNormalized, movementKind, layoutFingerprint, tableSignature, columnNormalized, semanticField: semanticField as PerseusSemanticRule["semanticField"], state: state as PerseusSemanticRule["state"], version: row.version as number };
}

export function perseusTableSignature(table: PerseusTable) {
  return table.columns
    .map((column) => column.normalized)
    .sort()
    .join("|");
}

/** Exact matching is deliberate: learned mappings never cross a context boundary. */
export function compatiblePerseusRules(
  rules: PerseusSemanticRule[],
  context: PerseusRuleContext,
  columnNormalized: string,
) {
  return rules.filter(
    (rule) =>
      rule.state === "ACTIVE" &&
      rule.columnNormalized === columnNormalized &&
      rule.domain === context.domain &&
      rule.billingEntityId === context.billingEntityId &&
      rule.payerNormalized === context.payerNormalized &&
      rule.movementKind === context.movementKind &&
      rule.layoutFingerprint === context.layoutFingerprint &&
      rule.tableSignature === context.tableSignature,
  );
}

export function learnedRuleDecision(rules: PerseusSemanticRule[]):
  | { kind: "none" }
  | { kind: "suggestion"; field: PerseusSemanticField | null; ruleId: string }
  | { kind: "conflict" } {
  const fields = new Set(rules.map((rule) => rule.semanticField || ""));
  if (!rules.length) return { kind: "none" };
  if (fields.size !== 1) return { kind: "conflict" };
  const first = rules[0];
  return { kind: "suggestion", field: first.semanticField, ruleId: first.id };
}
