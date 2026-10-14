import type { PerseusTable } from "../contracts";
import type { PerseusSemanticField } from "../semantic/contracts";
import type { PerseusRuleContext, PerseusSemanticRule } from "./contracts";

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
