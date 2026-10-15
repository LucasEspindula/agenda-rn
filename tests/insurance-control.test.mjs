import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadTs } from "./load-ts.mjs";

const read = (path) => readFileSync(path, "utf8");
const control = loadTs("lib/insurance-control.ts");
const workspace = loadTs("app/billing/insurance-control.ts");

const documents = [
  {
    id: "one",
    originalFilename: "unimed-outubro.csv",
    detectedFormat: "CSV",
    uploadStatus: "READY",
    perseusStatus: "NOT_ANALYZED",
    createdAt: "2026-10-13T10:00:00Z",
    importer: "Lucas",
    rejectionReason: null,
    analysis: null,
    movement: {
      payer: "Unimed",
      competence: "2026-10-01",
      kind: "UNKNOWN",
      external_reference: "PROTO-1",
      billing_entity: { name: "Clínica Central", trade_name: null },
    },
  },
  {
    id: "two",
    originalFilename: "bradesco.xml",
    detectedFormat: "XML",
    uploadStatus: "READY",
    perseusStatus: "REVIEW_REQUIRED",
    createdAt: "2026-10-12T10:00:00Z",
    importer: "Roseni",
    rejectionReason: null,
    analysis: null,
    movement: {
      payer: "Bradesco",
      competence: null,
      kind: "UNKNOWN",
      external_reference: null,
      billing_entity: { name: "Hospital Norte", trade_name: "Norte" },
    },
  },
];
const entities = [
  { id: "central", name: "Clínica Central", trade_name: null },
  { id: "norte", name: "Hospital Norte", trade_name: "Norte" },
];

test("Perseu keeps the document lifecycle isolated from financial records", () => {
  assert.equal(control.canManageInsurance("general_manager"), true);
  assert.equal(control.canManageInsurance("doctor"), false);
  const migration = read(
    "supabase/migrations/20261009153000_insurance_control_perseus_foundation.sql",
  );
  assert.doesNotMatch(
    migration,
    /alter table public\.(billing_records|invoices|invoice_billing_records)/,
  );
  assert.doesNotMatch(
    read("app/billing/insurance-control.tsx"),
    /billing_records|invoice_billing_records|attendances/,
  );
});

test("Perseu validates Contexto before the file step", () => {
  assert.equal(
    workspace.perseusContextError({ billingEntityId: "", payer: "UNIMED" }),
    "billingEntityId",
  );
  assert.equal(
    workspace.perseusContextError({ billingEntityId: "entity", payer: "   " }),
    "payer",
  );
  assert.equal(
    workspace.perseusContextError({
      billingEntityId: "entity",
      payer: "UNIMED",
    }),
    null,
  );
});

test("Perseu filters the locally loaded document list without a new API", () => {
  assert.deepEqual(
    workspace
      .filterPerseusDocuments(
        documents,
        { query: "proto-1", entityId: "", format: "" },
        entities,
      )
      .map((item) => item.id),
    ["one"],
  );
  assert.deepEqual(
    workspace
      .filterPerseusDocuments(
        documents,
        { query: "", entityId: "norte", format: "" },
        entities,
      )
      .map((item) => item.id),
    ["two"],
  );
  assert.deepEqual(
    workspace
      .filterPerseusDocuments(
        documents,
        { query: "", entityId: "", format: "CSV" },
        entities,
      )
      .map((item) => item.id),
    ["one"],
  );
  assert.equal(workspace.selectedPerseusDocument(documents, "two")?.id, "two");
});

test("Perseu is an independent manager-only route with a shared billing subnav", () => {
  const page = read("app/perseu/page.tsx");
  const client = read("app/perseu/perseus-client.tsx");
  const nav = read("app/billing/billing-subnav.tsx");
  assert.match(page, /session\.account\.role !== "general_manager"/);
  assert.match(page, /<PerseusClient\s*\/>/);
  assert.match(client, /fetch\("\/api\/billing"/);
  assert.match(client, /<BillingSubnav active="perseu"/);
  assert.match(
    client,
    /<InsuranceControl data=\{data\} pendingCount=\{pendingCount\}/,
  );
  assert.match(nav, /href="\/perseu"/);
  assert.match(nav, /className="billing-subnav-financial"/);
  assert.match(nav, /className="billing-subnav-perseus"/);
});

test("Convênios contains only Pendências and does not mount Perseu workspace", () => {
  const billing = read("app/billing/billing-client.tsx");
  assert.match(billing, /<BillingSubnav\s+active=\{tab\}/);
  assert.match(billing, /tab === "insurance"[\s\S]{0,220}<InsurancePending/);
  assert.doesNotMatch(billing, /InsuranceControl/);
  assert.doesNotMatch(billing, /insuranceView/);
  assert.doesNotMatch(billing, /insurance-workspace-tabs/);
});

test("document notices stay contextual and stale preview errors cannot leak to another selection", () => {
  const ui = read("app/billing/insurance-control.tsx");
  assert.match(ui, /Record<string, DocumentNotice>/);
  assert.match(ui, /\[document\.id\]: \{[\s\S]{0,220}tone: "info"/);
  assert.match(
    ui,
    /Este documento foi importado corretamente, mas a análise estruturada/,
  );
  assert.match(ui, /notices\[selected\.id\]/);
  assert.match(ui, /aria-label="Fechar aviso"/);
  assert.match(ui, /analysisRequest\.current/);
  assert.match(ui, /documentId: document\.id/);
  assert.match(ui, /previewError\?\.documentId === selected\.id/);
  assert.match(ui, /className="billing-error perseus-import-error"/);
  assert.match(ui, /className="perseus-list-error"/);
});

test("premium Perseu workspace remains the sole document UI with existing actions", () => {
  const ui = read("app/billing/insurance-control.tsx");
  const css = read("app/billing/billing.css");
  assert.match(ui, /className="perseus-workspace"/);
  assert.match(ui, /Importação e análise documental<\/p>/);
  assert.doesNotMatch(ui, /Importação e análise documental de convênios/);
  assert.match(ui, /Analisar com Perseu/);
  assert.match(ui, /Reanalisar com Perseu/);
  assert.match(ui, /Ver prévia estruturada/);
  assert.match(css, /\.billing-subnav-financial\{[^}]*overflow-x:auto/);
  assert.match(css, /\.billing-subnav \.billing-subnav-perseus\{/);
  assert.match(css, /\.perseus-context-notice\.info/);
  assert.match(css, /\.perseus-context-notice\.error/);
});

test("structural preview stays separate and only its table scrolls horizontally", () => {
  const ui = read("app/billing/insurance-control.tsx");
  const css = read("app/billing/billing.css");
  assert.match(ui, /className="perseus-preview-dialog"/);
  assert.match(ui, /sourceMetadata/);
  assert.match(css, /\.perseus-preview-table-wrap\{[^}]*overflow-x:auto/);
  assert.match(css, /\.perseus-preview-table\{min-width:760px/);
  assert.doesNotMatch(css, /\.perseus-semantic-summary\{[^}]*overflow-x:auto/);
});

test("Perseu opens history as an independent responsive panel", () => {
  const ui = read("app/billing/insurance-control.tsx");
  const css = read("app/billing/billing.css");
  assert.match(ui, /function PerseusDocumentHistoryPanel/);
  assert.match(ui, /className="perseus-history-panel"/);
  assert.match(ui, /aria-controls="perseus-history-panel"/);
  assert.match(ui, /historyOpen && \(\s*<PerseusDocumentHistoryPanel/);
  assert.doesNotMatch(ui, /<section className="perseus-history"/);
  assert.match(css, /\.perseus-workspace-body\.history-open\{grid-template-columns:minmax\(320px,1fr\) minmax\(320px,382px\) minmax\(300px,350px\)/);
  assert.match(css, /@media\(max-width:1380px\)\{\.perseus-workspace-body\.history-open/);
  assert.match(css, /\.perseus-history-panel\{display:flex;flex-direction:column/);
  assert.match(css, /\.perseus-history-panel-body\{[^}]*overflow-y:auto/);
});

test("Perseu history keeps the current document and reports the pending migration honestly", () => {
  const route = read("app/api/insurance-control/events/route.ts");
  const ui = read("app/billing/insurance-control.tsx");
  assert.match(route, /const ledgerUnavailable = events\.error\?\.code === "42P01"/);
  assert.match(route, /availability: ledgerUnavailable \? "MIGRATION_PENDING" : "READY"/);
  assert.match(ui, /histórico persistente será ativado após a migration pendente/);
  assert.match(ui, /historyRequest = useRef\(0\)/);
  assert.match(ui, /nextCursor/);
});
