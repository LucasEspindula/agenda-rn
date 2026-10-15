import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {loadTs} from "./load-ts.mjs";

const engine=loadTs("lib/perseu/document-intelligence.ts");
const bytes=(value)=>new TextEncoder().encode(value);

test("Perseu global identifica bytes reais e classifica texto sem executar operação",()=>{
 assert.equal(engine.detectPerseusGlobalFormat(bytes("nome;guia\nAna;1\n"),"retorno.csv"),"CSV");
 assert.equal(engine.detectPerseusGlobalFormat(bytes("nota fiscal de serviço"),"nota.txt"),"TXT");
 const result=engine.inspectGlobalPerseusDocument(bytes("NOTA FISCAL de serviço"),"nota.txt");
 assert.equal(result.documentClass,"INVOICE");
 assert.equal(result.evidence[0].source.method,"LOCAL_TEXT");
 assert.equal(result.extractedData.patient_name,undefined);
});

test("Perseu global aceita imagem somente pela assinatura física",()=>{
 const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
 assert.equal(engine.detectPerseusGlobalFormat(png,"qualquer.bin"),"PNG");
 assert.equal(engine.detectPerseusGlobalFormat(bytes("não é imagem"),"imagem.png"),null);
});

test("Fase 4 persiste somente documentos, evidências e propostas — sem escrita financeira",()=>{
 const migration=readFileSync("supabase/migrations/20261015190000_perseus_global_documents.sql","utf8");
 assert.match(migration,/create table public\.perseus_documents/);
 assert.match(migration,/create table public\.perseus_document_evidences/);
 assert.match(migration,/create table public\.perseus_operational_proposals/);
 assert.match(migration,/claim_perseus_document_processing/);
 assert.match(migration,/for update/);
 assert.doesNotMatch(migration,/billing_records|invoices|invoice_billing_records|attendance_id/);
 assert.match(migration,/revoke all on table .*anon,authenticated/);
});

test("Provedor multimodal é server-side, opcional e não inventa análise sem configuração",()=>{
 const provider=readFileSync("lib/perseu/multimodal-provider.ts","utf8");
 assert.match(provider,/PERSEUS_MULTIMODAL_CONSENT/);
 assert.match(provider,/OPENAI_API_KEY/);
 assert.match(provider,/store:\s*false/);
 assert.match(provider,/untrusted data/);
 const route=readFileSync("app/api/perseu/documents/analyze/route.ts","utf8");
 assert.match(route,/canManageInsurance/);
 assert.match(route,/consumeLimit/);
 assert.match(route,/claim_perseus_document_processing/);
 assert.doesNotMatch(route,/billing_records|invoice_billing_records|attendances/);
});
