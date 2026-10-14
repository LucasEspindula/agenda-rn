import type {
  PerseusParseResult,
  PerseusRawItem,
  PerseusTable,
} from "../contracts";
import { GENERIC_HEADERS, INSURANCE_SEMANTIC_DICTIONARY } from "./dictionary";
import {
  normalizeAmount,
  normalizeDate,
  normalizeIdentifier,
  normalizeSemanticLabel,
  normalizeSemanticText,
} from "./normalize";
import {
  PERSEUS_SEMANTIC_VERSION,
  type PerseusNormalizedData,
  type PerseusSemanticField,
  type PerseusSemanticResult,
  type SemanticClassification,
  type SemanticColumnInterpretation,
} from "./contracts";
import {
  compatiblePerseusRules,
  learnedRuleDecision,
  perseusTableSignature,
} from "../supervision/rules";
import type { PerseusRuleContext, PerseusSemanticRule } from "../supervision/contracts";

type Candidate = {
  field: PerseusSemanticField;
  score: number;
  reasons: string[];
};

function valuesFor(items: PerseusRawItem[], key: string) {
  return items
    .map((item) => item.rawData[key])
    .filter(
      (value) => value !== null && value !== undefined && String(value).trim(),
    );
}

function quality(field: PerseusSemanticField, values: unknown[]) {
  if (!values.length)
    return { score: 0, reason: "coluna sem valores utilizáveis" };
  const valid = values.filter((value) => {
    if (field === "service_date") return Boolean(normalizeDate(value).value);
    if (field.startsWith("amount_"))
      return Boolean(normalizeAmount(value).value);
    if (
      ["guide_number", "beneficiary_number", "procedure_code"].includes(field)
    )
      return Boolean(normalizeIdentifier(value));
    return Boolean(normalizeSemanticText(value));
  }).length;
  return valid / values.length >= 0.8
    ? { score: 2, reason: "padrão de valores consistente" }
    : { score: 0, reason: "padrão de valores insuficiente" };
}

function candidates(
  column: { original: string; key: string },
  items: PerseusRawItem[],
) {
  const label = normalizeSemanticLabel(column.original);
  if (GENERIC_HEADERS.has(label)) return [] as Candidate[];
  return INSURANCE_SEMANTIC_DICTIONARY.flatMap((entry) => {
    const exact = entry.labels.includes(label);
    const contains = entry.labels.some(
      (alias) => label.includes(alias) || alias.includes(label),
    );
    if (!exact && !contains) return [];
    const result = quality(entry.field, valuesFor(items, column.key));
    return [
      {
        field: entry.field,
        score: (exact ? 8 : 5) + result.score,
        reasons: [
          exact ? "cabeçalho reconhecido" : "variação de cabeçalho reconhecida",
          result.reason,
        ],
      },
    ];
  });
}

function interpretation(
  table: PerseusTable,
  column: { original: string; key: string },
  items: PerseusRawItem[],
): SemanticColumnInterpretation {
  const ranked = candidates(column, items).sort(
    (left, right) => right.score - left.score,
  );
  const best = ranked[0];
  const second = ranked[1];
  let classification: SemanticClassification = "UNKNOWN";
  let field: PerseusSemanticField | null = null;
  const warnings: string[] = [];
  if (best && second && best.score - second.score <= 1) {
    classification = "AMBIGUOUS";
    warnings.push("Há significados concorrentes para esta coluna.");
  } else if (best) {
    field = best.field;
    classification = best.score >= 9 ? "HIGH" : "MEDIUM";
  }
  return {
    field,
    sourceColumn: column.original,
    sourceKey: column.key,
    tableId: table.tableId,
    classification,
    reasons: best?.reasons || ["Cabeçalho sem evidência semântica suficiente."],
    warnings,
  };
}

function normalizeField(field: PerseusSemanticField, value: unknown) {
  if (field === "service_date") return normalizeDate(value);
  if (field.startsWith("amount_")) return normalizeAmount(value);
  if (
    [
      "guide_number",
      "beneficiary_number",
      "procedure_code",
      "gloss_code",
    ].includes(field)
  )
    return { value: normalizeIdentifier(value), warning: undefined };
  return { value: normalizeSemanticText(value), warning: undefined };
}

function totalRow(item: PerseusRawItem) {
  return Object.values(item.rawData).some((value) =>
    /^(sub)?total$/i.test(String(value).trim()),
  );
}

export function interpretPerseusSemantics(
  result: PerseusParseResult,
  learned?: { context: Omit<PerseusRuleContext, "tableSignature">; rules: PerseusSemanticRule[] },
): PerseusParseResult {
  const tables = result.structure.tables || [];
  const semanticTables = tables.map((table) => {
    const tableItems = result.items.filter(
      (item) => item.source?.tableId === table.tableId,
    );
    const columns = table.columns.map((column) => {
      const current = interpretation(table, column, tableItems);
      if (!learned) return current;
      const decision = learnedRuleDecision(
        compatiblePerseusRules(learned.rules, {
          ...learned.context,
          tableSignature: perseusTableSignature(table),
        }, column.normalized),
      );
      if (decision.kind === "none") return current;
      if (decision.kind === "conflict")
        return { ...current, field: null, classification: "AMBIGUOUS" as const, origin: "CONFLICT" as const, warnings: [...current.warnings, "Há regras aprendidas conflitantes; revisão humana é necessária."] };
      return {
        ...current,
        field: decision.field,
        classification: (decision.field ? "MEDIUM" : "UNKNOWN") as SemanticClassification,
        origin: "LEARNED_SUGGESTION" as const,
        ruleId: decision.ruleId,
        reasons: ["Sugestão aprendida de revisão humana compatível."],
        warnings: decision.field ? [] : ["Coluna rejeitada em revisão humana anterior."],
      };
    });
    const fieldCounts = new Map<PerseusSemanticField, number>();
    for (const column of columns)
      if (column.field)
        fieldCounts.set(column.field, (fieldCounts.get(column.field) || 0) + 1);
    for (const column of columns) {
      if (column.field && (fieldCounts.get(column.field) || 0) > 1) {
        column.field = null;
        column.classification = "AMBIGUOUS";
        column.warnings.push(
          "Mais de uma coluna candidata ao mesmo significado.",
        );
      }
    }
    return {
      tableId: table.tableId,
      columns,
      warnings: columns.flatMap((column) => column.warnings),
    };
  });
  const byTable = new Map(
    semanticTables.map((table) => [table.tableId, table]),
  );
  result.items = result.items.map((item) => {
    const table = item.source?.tableId
      ? byTable.get(item.source.tableId)
      : undefined;
    const normalizedData: PerseusNormalizedData = {};
    const semanticEvidence: Record<string, unknown> = {};
    if (table && !totalRow(item)) {
      for (const column of table.columns) {
        if (
          !column.field ||
          !["HIGH", "MEDIUM"].includes(column.classification)
        )
          continue;
        const normalized = normalizeField(
          column.field,
          item.rawData[column.sourceKey],
        );
        if (normalized.value) normalizedData[column.field] = normalized.value;
        semanticEvidence[column.field] = {
          ...column,
          origin: column.origin || "HEURISTIC",
          warnings: [
            ...column.warnings,
            ...(normalized.warning ? [normalized.warning] : []),
          ],
        };
      }
    }
    return { ...item, normalizedData, semanticEvidence };
  });
  const semantic: PerseusSemanticResult = {
    version: PERSEUS_SEMANTIC_VERSION,
    tables: semanticTables,
  };
  return { ...result, semantic };
}
