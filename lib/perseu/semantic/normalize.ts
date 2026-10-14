import { normalizeStructuralKey } from "../normalize";

export function normalizeSemanticLabel(value: unknown) {
  return normalizeStructuralKey(value).replace(/_/g, " ");
}

export function normalizeSemanticText(value: unknown) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text || undefined;
}

export function normalizeIdentifier(value: unknown) {
  const text = normalizeSemanticText(value);
  return text ? text.replace(/\s+/g, "") : undefined;
}

export function normalizeDate(value: unknown) {
  const text = normalizeSemanticText(value);
  if (!text) return { value: undefined, warning: undefined };
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  const year = iso?.[1] || br?.[3];
  const month = iso?.[2] || br?.[2];
  const day = iso?.[3] || br?.[1];
  if (!year || !month || !day)
    return { value: undefined, warning: "Data fora de um formato seguro." };
  const parsed = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)),
  );
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  )
    return { value: undefined, warning: "Data inválida." };
  return { value: `${year}-${month}-${day}`, warning: undefined };
}

export function normalizeAmount(value: unknown) {
  const text = normalizeSemanticText(value);
  if (!text) return { value: undefined, warning: undefined };
  let source = text.replace(/^R\$\s*/i, "").replace(/\s/g, "");
  if (!/^-?[\d.,]+$/.test(source))
    return { value: undefined, warning: "Valor monetário inválido." };
  const negative = source.startsWith("-");
  source = source.replace(/^-/, "");
  const comma = source.lastIndexOf(",");
  const dot = source.lastIndexOf(".");
  let decimal = "";
  if (comma >= 0 && dot >= 0) decimal = comma > dot ? "," : ".";
  else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? "," : ".";
    const fraction = source.slice(source.lastIndexOf(separator) + 1);
    if (fraction.length === 3)
      return { value: undefined, warning: "Valor monetário ambíguo." };
    decimal = separator;
  }
  const normalized = decimal
    ? source.replace(decimal === "," ? /\./g : /,/g, "").replace(decimal, ".")
    : source;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized))
    return { value: undefined, warning: "Valor monetário inválido." };
  const [whole, fraction = ""] = normalized.split(".");
  return {
    value: `${negative ? "-" : ""}${whole}.${fraction.padEnd(2, "0")}`,
    warning: undefined,
  };
}
