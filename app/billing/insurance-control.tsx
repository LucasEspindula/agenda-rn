"use client";

import { useEffect, useRef, useState } from "react";
import type { BillingData } from "@/lib/billing-types";
import AppDialog from "@/components/app-dialog";
import PerseusMark from "@/components/perseus-mark";
import {
  INSURANCE_MOVEMENT_KINDS,
  insuranceDocumentState,
  insuranceMovementLabels,
} from "@/lib/insurance-control";
import {
  cancelInsuranceDocument,
  uploadInsuranceDocument,
  insuranceDocumentAccept,
  INSURANCE_DOCUMENT_MAX_SIZE,
} from "@/lib/insurance-documents-client";
import { formatDateBR, formatDateTimeBR } from "@/lib/date-format";

type AnalysisTable = {
  table_id: string;
  source?: { sheet?: string; path?: string };
  region?: {
    rowStart?: number;
    rowEnd?: number;
    columnStart?: number;
    columnEnd?: number;
    path?: string;
  };
  header_location?: { row?: number; column?: number; path?: string };
  columns?: {
    original: string;
    key: string;
    normalized: string;
    position?: number;
  }[];
  record_count: number;
  warnings?: string[];
};
type Analysis = {
  parsed_at?: string;
  parser_key?: string;
  parser_version?: string;
  format?: string;
  row_count?: number;
  column_count?: number;
  sheet_count?: number;
  layout_fingerprint?: string;
  warnings?: string[];
  error?: string;
  structure?: { tables?: AnalysisTable[] };
  semantic?: {
    version?: string;
    tables?: {
      tableId: string;
      warnings?: string[];
      columns: {
        field: string | null;
        sourceColumn: string;
        sourceKey: string;
        classification: "HIGH" | "MEDIUM" | "AMBIGUOUS" | "UNKNOWN";
        origin?: "HEURISTIC" | "LEARNED_SUGGESTION" | "USER_CONFIRMED" | "USER_REJECTED" | "CONFLICT";
        reasons: string[];
        warnings: string[];
      }[];
    }[];
  };
};
type DocumentRow = {
  id: string;
  originalFilename: string;
  detectedFormat: string | null;
  uploadStatus: string;
  perseusStatus: string;
  createdAt: string;
  importer: string;
  rejectionReason: string | null;
  analysis: Analysis | null;
  movement: {
    payer: string;
    competence: string | null;
    kind: keyof typeof insuranceMovementLabels;
    external_reference: string | null;
    billing_entity: { name: string; trade_name: string | null };
  };
};
type Preview = {
  document: DocumentRow;
  summary: Analysis;
  updatedAt?: string;
  items: {
    id: string;
    sourceIndex: number;
    rawData: Record<string, unknown>;
    normalizedData: Record<string, string>;
    semanticEvidence: Record<string, unknown>;
    sourceMetadata: Record<string, unknown>;
  }[];
};
type Props = { data: BillingData; pendingCount: number };
type DocumentNotice = { tone: "info" | "error"; message: string };
type PreviewError = { documentId: string; message: string };
type PerseusStep = "context" | "file";
type WorkspaceFilters = { query: string; entityId: string; format: string };

const STEPS = [
  { id: "context", label: "Contexto" },
  { id: "file", label: "Arquivo" },
] as const;
const searchText = (value: string) => value.trim().toLocaleLowerCase("pt-BR");
const entityLabel = (entity: { name: string; trade_name: string | null }) =>
  entity.trade_name || entity.name;
const previewColumns = (items: Preview["items"]) => [
  ...new Set(items.flatMap((item) => Object.keys(item.rawData))),
];
const displayValue = (value: unknown) =>
  value === null || value === undefined || value === ""
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
const semanticLabel = (field: string) =>
  ({
    patient_name: "Paciente",
    beneficiary_number: "Número do beneficiário",
    guide_number: "Número da guia",
    external_reference: "Referência externa",
    service_date: "Data do atendimento",
    procedure_code: "Código do procedimento",
    procedure_description: "Procedimento",
    amount_presented: "Valor apresentado",
    amount_approved: "Valor aprovado",
    amount_glossed: "Valor glosado",
    gloss_code: "Código da glosa",
    gloss_reason: "Motivo da glosa",
  })[field] || "Não identificado";
const normalizedSummary = (values: Record<string, string>) =>
  Object.entries(values)
    .map(([field, value]) => `${semanticLabel(field)}: ${value}`)
    .join(" · ");
const semanticFields = [
  "patient_name","beneficiary_number","guide_number","external_reference","service_date","procedure_code","procedure_description","amount_presented","amount_approved","amount_glossed","gloss_code","gloss_reason",
];
function analysisText(document: DocumentRow) {
  if (document.perseusStatus === "REVIEW_REQUIRED")
    return { title: "Estrutura identificada", detail: "Revisão necessária" };
  if (document.perseusStatus === "FAILED")
    return {
      title: "Falha na análise",
      detail: document.analysis?.error || "Revise o arquivo e tente novamente.",
    };
  if (document.perseusStatus === "ANALYZED")
    return { title: "Análise concluída", detail: "" };
  return { title: "Aguardando análise", detail: "" };
}
function analysisAction(document: DocumentRow) {
  if (
    document.uploadStatus !== "READY" ||
    document.perseusStatus === "ANALYZED"
  )
    return null;
  if (document.perseusStatus === "REVIEW_REQUIRED")
    return "Reanalisar com Perseu";
  if (document.perseusStatus === "FAILED") return "Tentar novamente com Perseu";
  return "Analisar com Perseu";
}
function sourceLabel(source: Record<string, unknown>) {
  const sheet = typeof source.sheet === "string" ? source.sheet : "",
    row = typeof source.row === "number" ? source.row : null,
    path = typeof source.path === "string" ? source.path : "";
  if (sheet && row !== null) return "Aba: " + sheet + " · Linha: " + row;
  if (row !== null) return "Linha: " + row;
  return path ? "Origem: " + path : "";
}
function tableLabel(table: AnalysisTable) {
  const source = table.source?.sheet
    ? "Aba: " + table.source.sheet
    : table.source?.path
      ? "Origem: " + table.source.path
      : "Estrutura";
  const location = table.header_location?.row
    ? " · cabeçalho na linha " + table.header_location.row
    : "";
  return source + location;
}
const fileSize = (size: number) =>
  (size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) +
  " MB";
export function perseusContextError(values: {
  billingEntityId: string;
  payer: string;
}) {
  if (!values.billingEntityId) return "billingEntityId";
  if (!values.payer.trim()) return "payer";
  return null;
}
export function filterPerseusDocuments(
  documents: DocumentRow[],
  filters: WorkspaceFilters,
  entities: { id: string; name: string; trade_name: string | null }[],
) {
  const query = searchText(filters.query),
    entity = entities.find((item) => item.id === filters.entityId),
    target = entity ? searchText(entityLabel(entity)) : "";
  return documents.filter((document) => {
    const haystack = searchText(
      [
        document.originalFilename,
        document.movement.payer,
        document.movement.external_reference || "",
      ].join(" "),
    );
    return (
      (!query || haystack.includes(query)) &&
      (!target ||
        searchText(entityLabel(document.movement.billing_entity)) === target) &&
      (!filters.format || document.detectedFormat === filters.format)
    );
  });
}
export function selectedPerseusDocument(
  documents: DocumentRow[],
  selectedId: string,
) {
  return (
    documents.find((document) => document.id === selectedId) ||
    documents[0] ||
    null
  );
}

export default function InsuranceControl({ data, pendingCount }: Props) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]),
    [loadError, setLoadError] = useState(""),
    [importError, setImportError] = useState(""),
    [notices, setNotices] = useState<Record<string, DocumentNotice>>({}),
    [previewError, setPreviewError] = useState<PreviewError | null>(null),
    [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [analyzingId, setAnalyzingId] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [reviewingKey, setReviewingKey] = useState(""),
    [mappingSelections, setMappingSelections] = useState<Record<string, string>>({}),
    [previewTableId, setPreviewTableId] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [step, setStep] = useState<PerseusStep>("context"),
    [selectedId, setSelectedId] = useState(""),
    [detailOpen, setDetailOpen] = useState(true),
    [filters, setFilters] = useState<WorkspaceFilters>({
      query: "",
      entityId: "",
      format: "",
    }),
    [form, setForm] = useState({
      billingEntityId: "",
      payer: "",
      competence: "",
      kind: "UNKNOWN",
      externalReference: "",
    });
  const dialogRef = useRef<HTMLDialogElement>(null),
    triggerRef = useRef<HTMLButtonElement>(null),
    closeRef = useRef<HTMLButtonElement>(null),
    entityRef = useRef<HTMLSelectElement>(null),
    payerRef = useRef<HTMLInputElement>(null),
    analysisRequest = useRef(0);
  async function load() {
    const response = await fetch("/api/insurance-control", {
        cache: "no-store",
      }),
      payload = await response.json();
    if (!response.ok)
      throw Error(payload.error || "Não foi possível carregar os documentos.");
    setDocuments(payload.documents);
    setLoadError("");
  }
  function retryLoad() {
    void load().catch((reason) =>
      setLoadError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível carregar os documentos.",
      ),
    );
  }
  useEffect(() => {
    let active = true;
    setLoadError("");
    void fetch("/api/insurance-control", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw Error(
            payload.error || "Não foi possível carregar os documentos.",
          );
        return payload;
      })
      .then((payload) => {
        if (active) setDocuments(payload.documents);
      })
      .catch((reason) => {
        if (active)
          setLoadError(
            reason instanceof Error
              ? reason.message
              : "Não foi possível carregar os documentos.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    dialog.showModal();
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);
  const visibleDocuments = filterPerseusDocuments(
      documents,
      filters,
      data.entities,
    ),
    selected = detailOpen
      ? selectedPerseusDocument(visibleDocuments, selectedId)
      : null,
    ready = documents.filter((document) => document.uploadStatus === "READY"),
    formats = [
      ...new Set(
        documents
          .map((document) => document.detectedFormat)
          .filter((format): format is string => Boolean(format)),
      ),
    ].sort();
  const restoreFocus = () =>
    requestAnimationFrame(() => triggerRef.current?.focus());
  function resetImport() {
    setFile(null);
    setImportError("");
    setStep("context");
  }
  function openImport() {
    resetImport();
    setOpen(true);
  }
  function closeImport() {
    if (!busy) dialogRef.current?.close();
  }
  function handleDialogClose() {
    setOpen(false);
    resetImport();
    restoreFocus();
  }
  function handleCancel(event: React.SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    if (!busy) dialogRef.current?.close();
  }
  function goToFile() {
    if (busy) return;
    const invalid = perseusContextError(form);
    if (invalid) {
      setImportError(
        invalid === "billingEntityId"
          ? "Selecione a entidade recebedora."
          : "Informe o convênio/pagador.",
      );
      requestAnimationFrame(() => {
        const target =
          invalid === "billingEntityId" ? entityRef.current : payerRef.current;
        target?.focus();
        target?.reportValidity();
      });
      return;
    }
    setImportError("");
    setStep("file");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!file || perseusContextError(form)) return;
    setBusy(true);
    setImportError("");
    try {
      await uploadInsuranceDocument(file, { ...form, notes: "" });
      dialogRef.current?.close();
      await load();
    } catch (reason) {
      setImportError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível importar o arquivo.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel(document: DocumentRow) {
    if (
      !window.confirm(
        "Cancelar importação? O documento ficará registrado como rejeitado para auditoria.",
      )
    )
      return;
    setBusy(true);
    setNotices((current) => {
      const next = { ...current };
      delete next[document.id];
      return next;
    });
    try {
      await cancelInsuranceDocument(document.id);
      await load();
    } catch (reason) {
      setNotices((current) => ({
        ...current,
        [document.id]: {
          tone: "error",
          message:
            reason instanceof Error
              ? reason.message
              : "Não foi possível cancelar a importação.",
        },
      }));
    } finally {
      setBusy(false);
    }
  }
  async function analyze(document: DocumentRow) {
    const request = ++analysisRequest.current;
    setAnalyzingId(document.id);
    setNotices((current) => {
      const next = { ...current };
      delete next[document.id];
      return next;
    });
    try {
      const response = await fetch("/api/insurance-control/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: document.id }),
        }),
        payload = await response.json();
      if (!response.ok)
        throw Error(payload.error || "Não foi possível analisar o documento.");
      if (request !== analysisRequest.current) return;
      if (payload.unsupported) {
        const format = document.detectedFormat || "este formato";
        setNotices((current) => ({
          ...current,
          [document.id]: {
            tone: "info",
            message: `Este documento foi importado corretamente, mas a análise estruturada de ${format} ainda não está disponível.`,
          },
        }));
        return;
      }
      await load();
      setNotices((current) => {
        const next = { ...current };
        delete next[document.id];
        return next;
      });
    } catch (reason) {
      if (request === analysisRequest.current)
        setNotices((current) => ({
          ...current,
          [document.id]: {
            tone: "error",
            message:
              reason instanceof Error
                ? reason.message
                : "Não foi possível analisar o documento.",
          },
        }));
      await load().catch(() => undefined);
    } finally {
      if (request === analysisRequest.current) setAnalyzingId("");
    }
  }
  async function openPreview(document: DocumentRow, preferredTableId = "") {
    setPreviewError(null);
    try {
      const response = await fetch(
          "/api/insurance-control/analyze?id=" +
            encodeURIComponent(document.id) +
            "&limit=20",
          { cache: "no-store" },
        ),
        payload = await response.json();
      if (!response.ok)
        throw Error(payload.error || "Não foi possível carregar a prévia.");
      const next = {
        document,
        summary: payload.summary || {},
        items: payload.items || [],
        updatedAt: payload.updatedAt,
      } as Preview;
      setPreview(next);
      setMappingSelections(Object.fromEntries((next.summary.semantic?.tables || []).flatMap((table) => table.columns.map((column) => [table.tableId + ":" + column.sourceKey, column.field || ""]))));
      const availableTables = next.summary.structure?.tables || [];
      setPreviewTableId(
        availableTables.some((table) => table.table_id === preferredTableId)
          ? preferredTableId
          : availableTables[0]?.table_id ||
            String(next.items[0]?.sourceMetadata.table_id || ""),
      );
    } catch (reason) {
      setPreviewError({
        documentId: document.id,
        message:
          reason instanceof Error
            ? reason.message
            : "Não foi possível carregar a prévia.",
      });
    }
  }
  async function reviewMapping(document: DocumentRow, tableId: string, sourceKey: string, semanticField: string | null, learn: boolean) {
    if (!preview?.updatedAt) return;
    const key = tableId + ":" + sourceKey;
    setReviewingKey(key);
    try {
      const response = await fetch("/api/insurance-control/semantic-review", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: document.id, tableId, sourceKey, semanticField, learn, expectedUpdatedAt: preview.updatedAt }),
      }), payload = await response.json();
      if (!response.ok) throw Error(payload.error || "Não foi possível registrar a revisão.");
      await load();
      await openPreview(document, previewTableId);
    } catch (reason) {
      setPreviewError({ documentId: document.id, message: reason instanceof Error ? reason.message : "Não foi possível registrar a revisão." });
    } finally { setReviewingKey(""); }
  }
  async function correctValue(itemId: string, field: string, value: string) {
    if (!preview?.updatedAt) return;
    const key = "value:" + itemId + ":" + field;
    setReviewingKey(key);
    try {
      const response = await fetch("/api/insurance-control/semantic-review", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ documentId: preview.document.id, itemId, semanticField: field, value, expectedUpdatedAt: preview.updatedAt }) }), payload = await response.json();
      if (!response.ok) throw Error(payload.error || "Não foi possível corrigir o valor.");
      await load(); await openPreview(preview.document, previewTableId);
    } catch (reason) { setPreviewError({ documentId: preview.document.id, message: reason instanceof Error ? reason.message : "Não foi possível corrigir o valor." }); }
    finally { setReviewingKey(""); }
  }
  return (
    <>
      <section className="perseus-workspace" aria-label="Workspace Perseu">
        <header className="perseus-compact-header">
          <div className="perseus-identity">
            <div className="perseus-identity-signature">
              <PerseusMark size={64} className="perseus-identity-mark" />
            </div>
            <div className="perseus-identity-copy">
              <span className="perseus-eyebrow">Análise documental</span>
              <h2>Perseu</h2>
              <p>Importação e análise documental</p>
            </div>
          </div>
          <div className="perseus-header-actions">
            <div
              className="perseus-summary-inline"
              aria-label="Resumo de documentos"
            >
              <span>
                <small>Pendências</small>
                <strong>{pendingCount}</strong>
              </span>
              <span>
                <small>Importados</small>
                <strong>{ready.length}</strong>
              </span>
              <span>
                <small>Aguardando análise</small>
                <strong>
                  {
                    ready.filter(
                      (document) => document.perseusStatus === "NOT_ANALYZED",
                    ).length
                  }
                </strong>
              </span>
              <span>
                <small>Convênios</small>
                <strong>
                  {
                    new Set(ready.map((document) => document.movement.payer))
                      .size
                  }
                </strong>
              </span>
            </div>
            <button
              ref={triggerRef}
              className="billing-primary perseus-import-button"
              type="button"
              onClick={openImport}
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              <span aria-hidden="true">↥</span>Importar documento
            </button>
          </div>
        </header>
        <div
          className={
            "perseus-workspace-body" +
            (!detailOpen || !selected ? " detail-hidden" : "")
          }
        >
          <section
            className="perseus-document-list"
            aria-label="Documentos importados"
          >
            <div className="perseus-list-toolbar">
              <input
                aria-label="Buscar arquivo, convênio ou referência"
                type="search"
                value={filters.query}
                onChange={(event) =>
                  setFilters({ ...filters, query: event.target.value })
                }
                placeholder="Buscar arquivo…"
              />
              <select
                aria-label="Todas as Empresas"
                value={filters.entityId}
                onChange={(event) =>
                  setFilters({ ...filters, entityId: event.target.value })
                }
              >
                <option value="">Todas as Empresas</option>
                {data.entities.map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entityLabel(entity)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Formatos"
                value={filters.format}
                onChange={(event) =>
                  setFilters({ ...filters, format: event.target.value })
                }
              >
                <option value="">Formatos</option>
                {formats.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </select>
            </div>
            <div className="perseus-list-scroll">
              {loadError ? (
                <section className="perseus-list-error" role="alert">
                  <p>{loadError}</p>
                  <button
                    className="billing-secondary"
                    type="button"
                    onClick={retryLoad}
                  >
                    Tentar novamente
                  </button>
                </section>
              ) : (
                <>
                  <table className="perseus-list-table">
                    <thead>
                      <tr>
                        <th>Documento &amp; status Perseu</th>
                        <th>Convênio / Pagador</th>
                        <th>Competência</th>
                        <th>Importação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDocuments.map((document) => {
                        const state = insuranceDocumentState(
                            document.uploadStatus,
                            document.rejectionReason,
                          ),
                          analysis = analysisText(document),
                          summary =
                            document.analysis?.row_count !== undefined
                              ? document.analysis.row_count +
                                " linhas · " +
                                (document.analysis.column_count || 0) +
                                " colunas"
                              : "";
                        return (
                          <tr
                            key={document.id}
                            className={
                              selected?.id === document.id ? "selected" : ""
                            }
                          >
                            <td>
                              <button
                                type="button"
                                className="perseus-document-select"
                                onClick={() => {
                                  setSelectedId(document.id);
                                  setDetailOpen(true);
                                }}
                                aria-current={
                                  selected?.id === document.id
                                    ? "true"
                                    : undefined
                                }
                              >
                                <strong>{document.originalFilename}</strong>
                                <span
                                  className={
                                    "perseus-row-status " +
                                    (document.uploadStatus === "READY"
                                      ? "ready"
                                      : state.tone)
                                  }
                                >
                                  {document.uploadStatus === "READY"
                                    ? analysis.title
                                    : state.label}
                                </span>
                                {summary && <small>{summary}</small>}
                              </button>
                            </td>
                            <td>
                              <strong>{document.movement.payer}</strong>
                              <small>
                                {
                                  insuranceMovementLabels[
                                    document.movement.kind
                                  ]
                                }
                              </small>
                            </td>
                            <td>
                              {document.movement.competence
                                ? formatDateBR(document.movement.competence)
                                : "—"}
                            </td>
                            <td>
                              <strong>
                                {formatDateTimeBR(document.createdAt)}
                              </strong>
                              <small>por {document.importer}</small>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!visibleDocuments.length && (
                    <p className="billing-empty">
                      Nenhum documento corresponde aos filtros.
                    </p>
                  )}
                </>
              )}
            </div>
          </section>
          {selected &&
            (() => {
              const analysis = analysisText(selected),
                action = analysisAction(selected),
                notice = notices[selected.id],
                url =
                  "/api/insurance-control/documents?id=" +
                  encodeURIComponent(selected.id);
              return (
                <aside
                  className="perseus-document-detail"
                  aria-label="Detalhes do documento"
                >
                  <header>
                    <h3>Detalhes do Documento</h3>
                    <button
                      type="button"
                      className="perseus-detail-close"
                      aria-label="Fechar detalhes"
                      onClick={() => setDetailOpen(false)}
                    >
                      ×
                    </button>
                  </header>
                  <div className="perseus-detail-body">
                    <section className="perseus-inspector-state">
                      <div className="perseus-inspector-state-main">
                        <PerseusMark size={38} />
                        <div>
                          <span>Estado Perseu</span>
                          <strong>{analysis.title}</strong>
                          <small>{analysis.detail || " "}</small>
                        </div>
                      </div>
                      {notice && (
                        <section
                          className={"perseus-context-notice " + notice.tone}
                          role={notice.tone === "error" ? "alert" : "status"}
                        >
                          <div>
                            <strong>
                              {notice.tone === "info"
                                ? "Formato ainda não suportado"
                                : "Não foi possível concluir"}
                            </strong>
                            <button
                              type="button"
                              aria-label="Fechar aviso"
                              onClick={() =>
                                setNotices((current) => {
                                  const next = { ...current };
                                  delete next[selected.id];
                                  return next;
                                })
                              }
                            >
                              ×
                            </button>
                          </div>
                          <p>{notice.message}</p>
                        </section>
                      )}
                    </section>
                    <dl className="perseus-meta-grid">
                      <div>
                        <dt>Competência</dt>
                        <dd>
                          {selected.movement.competence
                            ? formatDateBR(selected.movement.competence)
                            : "—"}
                        </dd>
                      </div>
                      <div>
                        <dt>Movimento</dt>
                        <dd>
                          {insuranceMovementLabels[selected.movement.kind]}
                        </dd>
                      </div>
                      <div>
                        <dt>Formato</dt>
                        <dd>{selected.detectedFormat || "—"}</dd>
                      </div>
                      <div>
                        <dt>Convênio / Pagador</dt>
                        <dd>{selected.movement.payer}</dd>
                      </div>
                    </dl>
                    <section className="perseus-original-file">
                      <h4>Arquivo original</h4>
                      <div>
                        <strong title={selected.originalFilename}>
                          {selected.originalFilename}
                        </strong>
                        {selected.uploadStatus === "READY" && (
                          <span>
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Abrir original"
                              title="Abrir original"
                            >
                              ↗
                            </a>
                            <a
                              href={url}
                              download
                              aria-label="Baixar original"
                              title="Baixar original"
                            >
                              ⇩
                            </a>
                          </span>
                        )}
                      </div>
                    </section>
                    {selected.rejectionReason && (
                      <p className="insurance-document-reason">
                        {selected.rejectionReason}
                      </p>
                    )}
                  </div>
                  <footer>
                    {action && (
                      <button
                        className="billing-primary"
                        type="button"
                        disabled={!!analyzingId}
                        onClick={() => void analyze(selected)}
                      >
                        {analyzingId === selected.id ? "Analisando…" : action}
                      </button>
                    )}
                    {previewError?.documentId === selected.id && (
                      <p className="perseus-preview-error" role="alert">
                        {previewError.message}
                      </p>
                    )}
                    {selected.perseusStatus === "REVIEW_REQUIRED" && (
                      <button
                        className="billing-secondary"
                        type="button"
                        onClick={() => void openPreview(selected)}
                      >
                        Ver prévia estruturada
                      </button>
                    )}
                    {selected.uploadStatus === "PENDING" && (
                      <button
                        className="billing-link-button perseus-cancel-action"
                        disabled={busy}
                        onClick={() => void cancel(selected)}
                      >
                        Cancelar importação
                      </button>
                    )}
                  </footer>
                </aside>
              );
            })()}
        </div>
      </section>
      {open && (
        <dialog
          ref={dialogRef}
          className="perseus-import-dialog"
          aria-labelledby="perseus-import-title"
          onCancel={handleCancel}
          onClose={handleDialogClose}
          onClick={(event) => {
            if (event.currentTarget === event.target) closeImport();
          }}
        >
          <form className="perseus-import-form" onSubmit={submit}>
            <header>
              <div>
                <span>RN Integra · Convênios</span>
                <h2 id="perseus-import-title">Importar com Perseu</h2>
              </div>
              <button
                ref={closeRef}
                className="perseus-import-close"
                type="button"
                aria-label="Fechar"
                disabled={busy}
                onClick={closeImport}
              >
                ×
              </button>
            </header>
            <nav
              className="perseus-import-steps"
              aria-label="Etapas da importação"
            >
              {STEPS.map((item, index) => (
                <button
                  key={item.id}
                  className={step === item.id ? "active" : ""}
                  type="button"
                  aria-current={step === item.id ? "step" : undefined}
                  disabled={busy}
                  onClick={
                    item.id === "file" ? goToFile : () => setStep("context")
                  }
                >
                  <i>{index + 1}</i>
                  {item.label}
                </button>
              ))}
              <span>
                <i>3</i>Análise posterior
              </span>
            </nav>
            {importError && (
              <p className="billing-error perseus-import-error" role="alert">
                {importError}
              </p>
            )}
            {step === "context" && (
              <section
                className="perseus-import-content"
                aria-labelledby="perseus-context"
              >
                <div>
                  <h3 id="perseus-context">Contexto</h3>
                  <p>
                    Informe a origem do documento antes de enviar o arquivo.
                  </p>
                </div>
                <div className="perseus-form-grid">
                  <label>
                    Empresa / entidade recebedora
                    <select
                      ref={entityRef}
                      required
                      value={form.billingEntityId}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          billingEntityId: event.target.value,
                        })
                      }
                    >
                      <option value="">Selecione</option>
                      {data.entities.map((entity) => (
                        <option key={entity.id} value={entity.id}>
                          {entityLabel(entity)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Convênio / pagador
                    <input
                      ref={payerRef}
                      required
                      list="insurance-payers"
                      value={form.payer}
                      onChange={(event) =>
                        setForm({ ...form, payer: event.target.value })
                      }
                    />
                    <datalist id="insurance-payers">
                      {data.payers.map((payer) => (
                        <option key={payer} value={payer} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    Competência
                    <input
                      type="month"
                      value={form.competence}
                      onChange={(event) =>
                        setForm({ ...form, competence: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Tipo do movimento/documento
                    <select
                      value={form.kind}
                      onChange={(event) =>
                        setForm({ ...form, kind: event.target.value })
                      }
                    >
                      {INSURANCE_MOVEMENT_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {insuranceMovementLabels[kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="perseus-field-wide">
                    Referência externa / protocolo
                    <input
                      value={form.externalReference}
                      onChange={(event) =>
                        setForm({
                          ...form,
                          externalReference: event.target.value,
                        })
                      }
                    />
                  </label>
                </div>
                <div className="perseus-import-actions">
                  <button
                    className="billing-primary"
                    type="button"
                    disabled={busy}
                    onClick={goToFile}
                  >
                    Continuar para arquivo
                  </button>
                </div>
              </section>
            )}
            {step === "file" && (
              <section
                className="perseus-import-content"
                aria-labelledby="perseus-file"
              >
                <div>
                  <h3 id="perseus-file">Arquivo</h3>
                  <p>Envie o documento recebido do convênio.</p>
                </div>
                <label className="perseus-file-picker">
                  <span>Selecionar arquivo</span>
                  <input
                    required
                    type="file"
                    accept={insuranceDocumentAccept}
                    onChange={(event) =>
                      setFile(event.target.files?.[0] || null)
                    }
                  />
                  <small>
                    PDF, XLSX, XLS, CSV, XML, TXT ou ZIP · até 25 MB
                  </small>
                </label>
                {file && (
                  <div className="perseus-file-summary">
                    <strong>{file.name}</strong>
                    <span>{fileSize(file.size)}</span>
                  </div>
                )}
                {file && file.size > INSURANCE_DOCUMENT_MAX_SIZE && (
                  <p className="billing-error">O arquivo excede 25 MB.</p>
                )}
                <div className="perseus-import-actions">
                  <button
                    type="button"
                    className="billing-secondary"
                    disabled={busy}
                    onClick={() => setStep("context")}
                  >
                    Voltar
                  </button>
                  <button
                    className="billing-primary"
                    disabled={
                      busy || !file || file.size > INSURANCE_DOCUMENT_MAX_SIZE
                    }
                  >
                    {busy ? "Importando…" : "Importar com Perseu"}
                  </button>
                </div>
              </section>
            )}
            <footer>
              <button
                type="button"
                className="billing-secondary"
                disabled={busy}
                onClick={closeImport}
              >
                Cancelar
              </button>
            </footer>
          </form>
        </dialog>
      )}
      {preview &&
        (() => {
          const tables = preview.summary.structure?.tables || [],
            selectedTable =
              tables.find((table) => table.table_id === previewTableId) ||
              tables[0],
            visibleItems = selectedTable
              ? preview.items.filter(
                  (item) =>
                    item.sourceMetadata.table_id === selectedTable.table_id,
                )
              : preview.items,
            columns = previewColumns(visibleItems),
            semanticTable = preview.summary.semantic?.tables?.find(
              (table) => table.tableId === selectedTable?.table_id,
            );
          return (
            <AppDialog
              label={
                "Prévia da análise de " + preview.document.originalFilename
              }
              onClose={() => setPreview(null)}
              className="perseus-preview-dialog"
            >
              <section className="perseus-preview">
                <h3>Estrutura identificada</h3>
                <p>
                  Primeiras {visibleItems.length} linhas da estrutura
                  selecionada. A revisão é necessária antes de qualquer
                  interpretação.
                </p>
                <dl>
                  <div>
                    <dt>Formato</dt>
                    <dd>
                      {preview.summary.format ||
                        preview.document.detectedFormat ||
                        "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Linhas</dt>
                    <dd>
                      {selectedTable?.record_count ??
                        preview.summary.row_count ??
                        "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Colunas</dt>
                    <dd>
                      {selectedTable?.columns?.length ??
                        preview.summary.column_count ??
                        "—"}
                    </dd>
                  </div>
                  <div>
                    <dt>Estruturas</dt>
                    <dd>{tables.length || "—"}</dd>
                  </div>
                  <div>
                    <dt>Parser</dt>
                    <dd>
                      {preview.summary.parser_key || "—"}{" "}
                      {preview.summary.parser_version
                        ? "· " + preview.summary.parser_version
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Fingerprint do layout</dt>
                    <dd className="perseus-fingerprint">
                      {preview.summary.layout_fingerprint || "—"}
                    </dd>
                  </div>
                </dl>
                {tables.length > 1 && (
                  <label className="perseus-preview-table-select">
                    Estrutura identificada
                    <select
                      value={selectedTable?.table_id || ""}
                      onChange={(event) =>
                        setPreviewTableId(event.target.value)
                      }
                    >
                      {tables.map((table) => (
                        <option key={table.table_id} value={table.table_id}>
                          {tableLabel(table)} · {table.record_count} registros
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {selectedTable && (
                  <p className="perseus-preview-structure-note">
                    {tableLabel(selectedTable)} ·{" "}
                    {selectedTable.columns
                      ?.map((column) => column.original)
                      .join(" · ")}
                  </p>
                )}
                {preview.summary.warnings?.length ? (
                  <ul className="perseus-warnings">
                    {preview.summary.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
                {semanticTable && (
                  <section className="perseus-semantic-summary">
                    <div>
                      <h4>Interpretação sugerida</h4>
                      <small>
                        Motor semântico {preview.summary.semantic?.version}
                      </small>
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Coluna</th>
                          <th>Significado</th>
                          <th>Confiança</th>
                          <th>Critérios</th>
                          <th>Revisão humana</th>
                        </tr>
                      </thead>
                      <tbody>
                        {semanticTable.columns.map((column) => (
                          <tr key={column.sourceKey}>
                            <td>{column.sourceColumn}</td>
                            <td>
                              {column.field
                                ? semanticLabel(column.field)
                                : "Não identificado"}
                            </td>
                            <td>
                              <span
                                className={
                                  "perseus-semantic-class " +
                                  column.classification.toLowerCase()
                                }
                              >
                                {column.classification}
                              </span>
                            </td>
                            <td>
                              {[...column.reasons, ...column.warnings].join(
                                " · ",
                              ) || "—"}
                            </td>
                            <td className="perseus-semantic-review">
                              <select
                                aria-label={"Significado de " + column.sourceColumn}
                                value={mappingSelections[semanticTable.tableId + ":" + column.sourceKey] ?? column.field ?? ""}
                                disabled={reviewingKey === semanticTable.tableId + ":" + column.sourceKey}
                                onChange={(event) => setMappingSelections((current) => ({ ...current, [semanticTable.tableId + ":" + column.sourceKey]: event.target.value }))}
                              >
                                <option value="">Não mapear</option>
                                {semanticFields.map((field) => <option key={field} value={field}>{semanticLabel(field)}</option>)}
                              </select>
                              <button
                                type="button"
                                className="billing-link-button"
                                disabled={!mappingSelections[semanticTable.tableId + ":" + column.sourceKey] || reviewingKey === semanticTable.tableId + ":" + column.sourceKey}
                                onClick={() => void reviewMapping(preview.document, semanticTable.tableId, column.sourceKey, mappingSelections[semanticTable.tableId + ":" + column.sourceKey] || null, true)}
                              >
                                {reviewingKey === semanticTable.tableId + ":" + column.sourceKey ? "Salvando…" : "Confirmar e aprender"}
                              </button>
                              <button type="button" className="billing-link-button" disabled={reviewingKey === semanticTable.tableId + ":" + column.sourceKey} onClick={() => void reviewMapping(preview.document, semanticTable.tableId, column.sourceKey, mappingSelections[semanticTable.tableId + ":" + column.sourceKey] || null, false)}>Aplicar revisão</button>
                              {column.origin && <small>Origem: {column.origin === "USER_CONFIRMED" ? "Confirmado pelo usuário" : column.origin === "LEARNED_SUGGESTION" ? "Sugestão aprendida" : column.origin === "USER_REJECTED" ? "Não mapeado pelo usuário" : "Heurística"}</small>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {semanticTable.warnings?.length ? (
                      <p>{semanticTable.warnings.join(" ")}</p>
                    ) : null}
                  </section>
                )}
                <div className="billing-panel perseus-preview-table-wrap">
                  <table className="billing-table perseus-preview-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        {columns.map((column) => (
                          <th key={column}>{column}</th>
                        ))}
                        <th>Interpretação normalizada</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleItems.map((item) => {
                        const source = sourceLabel(item.sourceMetadata);
                        return (
                          <tr key={item.sourceIndex}>
                            <td>
                              {item.sourceIndex + 1}
                              {source && (
                                <small className="perseus-source">
                                  {source}
                                </small>
                              )}
                            </td>
                            {columns.map((column) => (
                              <td key={column}>
                                {displayValue(item.rawData[column])}
                              </td>
                            ))}
                            <td>
                              {normalizedSummary(item.normalizedData) || "—"}
                              {Object.keys(item.normalizedData).length > 0 && (
                                <details className="perseus-value-corrections">
                                  <summary>Corrigir valores</summary>
                                  {Object.entries(item.normalizedData).map(([field, value]) => (
                                    <label key={field}>
                                      {semanticLabel(field)}
                                      <input
                                        defaultValue={value}
                                        disabled={reviewingKey === "value:" + item.id + ":" + field}
                                        onBlur={(event) => {
                                          if (event.target.value !== value) void correctValue(item.id, field, event.target.value);
                                        }}
                                      />
                                    </label>
                                  ))}
                                </details>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {!visibleItems.length && (
                    <p className="billing-empty">
                      Nenhum item estruturado foi identificado.
                    </p>
                  )}
                </div>
                <div className="billing-modal-actions">
                  <button
                    className="billing-secondary"
                    type="button"
                    onClick={() => setPreview(null)}
                  >
                    Fechar
                  </button>
                </div>
              </section>
            </AppDialog>
          );
        })()}
    </>
  );
}
