import type { PerseusInspection } from "./contracts";
import { parseCsv } from "./parsers/csv";
import { parseXlsx } from "./parsers/xlsx";
import { parseXml } from "./parsers/xml";
import { interpretPerseusSemantics } from "./semantic/detect";

export function inspectPerseusDocument(
  format: string | null,
  bytes: Uint8Array,
): PerseusInspection {
  if (format === "CSV")
    return {
      kind: "parsed",
      result: interpretPerseusSemantics(parseCsv(bytes)),
    };
  if (format === "XLSX")
    return {
      kind: "parsed",
      result: interpretPerseusSemantics(parseXlsx(bytes)),
    };
  if (format === "XML")
    return {
      kind: "parsed",
      result: interpretPerseusSemantics(parseXml(bytes)),
    };
  return {
    kind: "unsupported",
    format,
    message: "O Perseu ainda não possui parser para este formato.",
  };
}
