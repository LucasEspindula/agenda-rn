import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const read=(path)=>readFileSync(path,'utf8');
const control=loadTs('lib/insurance-control.ts');

test('Perseu validates physical formats without semantic parsing',()=>{
 assert.equal(control.detectInsuranceDocument(new Uint8Array([37,80,68,70,45]),'retorno.pdf'),'PDF');
 assert.equal(control.detectInsuranceDocument(new Uint8Array([208,207,17,224,161,177,26,225]),'retorno.xls'),'XLS');
 assert.equal(control.detectInsuranceDocument(new Uint8Array([80,75,3,4]),'retorno.xlsx'),'XLSX');
 assert.equal(control.detectInsuranceDocument(new TextEncoder().encode('<?xml version="1.0"?>'),'retorno.xml'),'XML');
 assert.equal(control.detectInsuranceDocument(new Uint8Array([77,90]),'malware.exe'),null);
});

test('Perseu isolates authorization, document lifecycle and duplicate context',()=>{
 assert.equal(control.canManageInsurance('general_manager'),true);
 assert.equal(control.canManageInsurance('doctor'),false);
 assert.equal(control.canManageInsurance('secretary'),false);
 assert.equal(control.insuranceDocumentState('PENDING').label,'Upload pendente');
 assert.equal(control.insuranceDocumentState('PENDING').tone,'pending');
 assert.equal(control.insuranceDocumentState('READY').tone,'ready');
 assert.equal(control.insuranceDocumentState('REJECTED','Arquivo duplicado.').label,'Importação rejeitada');
 assert.equal(control.insuranceDocumentState('REJECTED','Arquivo duplicado.').reason,'Arquivo duplicado.');
 assert.equal(control.sameInsuranceDocumentContext({billingEntityId:'entity',payer:' UNIMED  Porto Alegre ',competence:'2026-10-01'},{billingEntityId:'entity',payer:'unimed porto alegre',competence:'2026-10-01'}),true);
 assert.equal(control.sameInsuranceDocumentContext({billingEntityId:'entity',payer:'UNIMED',competence:'2026-10-01'},{billingEntityId:'entity',payer:'UNIMED',competence:'2026-11-01'}),false);
});

test('Perseu foundation stays document-only and exposes coherent states',()=>{
 const migration=read('supabase/migrations/20261009153000_insurance_control_perseus_foundation.sql');
 const docs=read('app/api/insurance-control/documents/route.ts');
 const listing=read('app/api/insurance-control/route.ts');
 const ui=read('app/billing/insurance-control.tsx');
 const billing=read('app/billing/billing-client.tsx');
 assert.match(migration,/create table public\.insurance_movements/);
 assert.match(migration,/create table public\.insurance_documents/);
 assert.match(migration,/create table public\.insurance_document_items/);
 assert.doesNotMatch(migration,/alter table public\.(billing_records|invoices|invoice_billing_records)/);
 assert.doesNotMatch(docs,/from\('(billing_records|invoices|invoice_billing_records)'\)/);
 assert.match(docs,/createSignedUploadUrl/);
 assert.match(docs,/createSignedUrl/);
 assert.match(docs,/createHash\('sha256'\)/);
 assert.match(docs,/sameInsuranceDocumentContext/);
 assert.match(docs,/Importação cancelada/);
 assert.match(listing,/rejectionReason/);
 assert.match(ui,/Cancelar importação/);
 assert.match(ui,/insurance-document-state/);
 assert.match(ui,/Abrir \/ Baixar original/);
 assert.match(ui,/perseus-floating-action/);
 assert.match(ui,/perseus-drawer/);
 assert.match(ui,/<dialog/);
 assert.match(ui,/showModal\(\)/);
 assert.match(ui,/onCancel=\{handleCancel\}/);
 assert.match(ui,/onClose=\{handleDialogClose\}/);
 assert.match(ui,/triggerRef\.current\?\.focus\(\)/);
 assert.match(ui,/PerseusMark/);
 assert.match(ui,/Analisar com Perseu/);
 assert.match(ui,/Estrutura identificada/);
 assert.match(ui,/Primeiras \{preview\.items\.length\} linhas/);
 assert.match(ui,/Pendências atuais/);
 assert.match(ui,/Documentos prontos\/importados/);
 assert.match(ui,/AppDialog/);
 assert.match(billing,/['"]Convênios['"]/);
 assert.match(billing,/InsurancePending/);
});

test('Convênios keeps one operational filter and consolidates Perseu in Documents',()=>{
 const billing=read('app/billing/billing-client.tsx');
 const ui=read('app/billing/insurance-control.tsx');
 const mark=read('components/perseus-mark.tsx');
 assert.match(billing,/useState<'pending'\|'documents'>\('documents'\)/);
 assert.doesNotMatch(billing,/insuranceView==='overview'/);
 assert.doesNotMatch(billing,/>Visão geral</);
 assert.match(billing,/tab!=='insurance'&&filterBar/);
 assert.match(billing,/<InsurancePending filters=\{filterBar\}/);
 assert.match(billing,/<InsuranceControl data=\{data\} view=\{insuranceView\}/);
 assert.match(ui,/view==='documents'&&<section className="insurance-control">/);
 assert.match(ui,/perseus-floating-action/);
 assert.match(ui,/aria-haspopup="dialog"/);
 assert.match(ui,/aria-expanded=\{open\}/);
 assert.match(ui,/event\.currentTarget===event\.target/);
 assert.match(mark,/width=\{size\} height=\{size\}/);
 assert.match(mark,/src="\/perseu\.png"/);
 assert.doesNotMatch(ui,/PerseusIcon/);
 assert.doesNotMatch(ui,/<svg/);
});

