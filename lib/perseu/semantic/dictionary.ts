import type { PerseusSemanticField } from "./contracts";

export type SemanticDictionaryEntry = {
  field: PerseusSemanticField;
  labels: string[];
  requiredTokens?: string[];
  forbiddenTokens?: string[];
};

export const INSURANCE_SEMANTIC_DICTIONARY: SemanticDictionaryEntry[] = [
  {
    field: "patient_name",
    labels: [
      "paciente",
      "beneficiario",
      "segurado",
      "nome do paciente",
      "nome do beneficiario",
    ],
  },
  {
    field: "beneficiary_number",
    labels: [
      "matricula",
      "carteirinha",
      "numero beneficiario",
      "numero do beneficiario",
      "nr beneficiario",
    ],
  },
  {
    field: "guide_number",
    labels: [
      "guia",
      "numero guia",
      "numero da guia",
      "guia tiss",
      "nr guia",
      "n guia",
    ],
  },
  {
    field: "external_reference",
    labels: [
      "referencia externa",
      "identificador externo",
      "protocolo",
      "referencia",
    ],
  },
  {
    field: "service_date",
    labels: [
      "data execucao",
      "data atendimento",
      "data realizacao",
      "data do atendimento",
      "data procedimento",
    ],
  },
  {
    field: "procedure_code",
    labels: [
      "codigo tuss",
      "cod procedimento",
      "codigo procedimento",
      "codigo do servico",
      "cod servico",
    ],
  },
  {
    field: "procedure_description",
    labels: [
      "procedimento",
      "servico realizado",
      "descricao do procedimento",
      "descricao servico",
    ],
  },
  {
    field: "amount_presented",
    labels: ["valor apresentado", "valor cobrado", "valor solicitado"],
  },
  {
    field: "amount_approved",
    labels: ["valor aprovado", "valor liberado", "valor reconhecido"],
  },
  { field: "amount_glossed", labels: ["valor glosado", "glosa financeira"] },
  {
    field: "gloss_code",
    labels: ["codigo da glosa", "codigo glosa", "codigo do motivo"],
  },
  {
    field: "gloss_reason",
    labels: ["justificativa da glosa", "motivo da glosa", "descricao da glosa"],
  },
];

export const GENERIC_HEADERS = new Set([
  "nome",
  "codigo",
  "valor",
  "total",
  "diferenca",
  "data",
  "numero",
  "descricao",
  "status",
]);
