import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const read=(path)=>readFileSync(path,'utf8');
const control=loadTs('lib/insurance-control.ts');
const drawer=loadTs('app/billing/insurance-control.ts');

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

test('Perseu validates Contexto before opening the file step',()=>{
 assert.equal(drawer.perseusContextError({billingEntityId:'',payer:'UNIMED'}),'billingEntityId');
 assert.equal(drawer.perseusContextError({billingEntityId:'entity',payer:''}),'payer');
 assert.equal(drawer.perseusContextError({billingEntityId:'entity',payer:'   '}),'payer');
 assert.equal(drawer.perseusContextError({billingEntityId:'entity',payer:'UNIMED'}),null);
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
 assert.match(ui,/Reanalisar com Perseu/);
 assert.match(ui,/Tentar novamente com Perseu/);
 assert.match(ui,/Estrutura identificada/);
 assert.match(ui,/Primeiras \{preview\.items\.length\} linhas/);
 assert.match(ui,/sourceMetadata/);
 assert.match(ui,/Aba: '\+sheet\+' · Linha: '\+row/);
 assert.match(ui,/className="perseus-preview-dialog"/);
 assert.doesNotMatch(ui,/<AppDialog[^>]*compact/);
 assert.match(ui,/Pendências atuais/);
 assert.match(ui,/Documentos prontos\/importados/);
 assert.match(ui,/AppDialog/);
 assert.match(billing,/['"]Convênios['"]/);
 assert.match(billing,/InsurancePending/);
});

test('Perseu preview is a wide inspector with only its table scrolling horizontally',()=>{
 const css=read('app/billing/billing.css');
 assert.match(css,/dialog\.perseus-preview-dialog\{[^}]*width:min\(1080px,calc\(100vw - 32px\)\)[^}]*overflow-x:hidden/);
 assert.match(css,/\.perseus-preview\{[^}]*min-width:0/);
 assert.match(css,/\.perseus-preview-table-wrap\{[^}]*overflow-x:auto[^}]*overflow-y:hidden/);
 assert.match(css,/\.perseus-preview-table\{min-width:760px/);
 assert.match(css,/\.perseus-preview \.perseus-fingerprint\{[^}]*word-break:break-all/);
 assert.doesNotMatch(css,/\.perseus-preview\{display:grid;gap:14px;min-width:min\(920px/);
});

test('Perseu drawer validates Contexto and keeps Análise as a future indicator',()=>{
 const ui=read('app/billing/insurance-control.tsx');
 const css=read('app/billing/billing.css');
 assert.match(ui,/type PerseusStep='context'\|'file'/);
 assert.match(ui,/function openDrawer\(\)\{resetDrawer\(\);setOpen\(true\);\}/);
 assert.match(ui,/function perseusContextError\(values:\{billingEntityId:string;payer:string\}\)\{if\(!values\.billingEntityId\)return 'billingEntityId';if\(!values\.payer\.trim\(\)\)return 'payer';return null;\}/);
 assert.match(ui,/function goToFile\(\)\{if\(busy\)return;const invalid=perseusContextError\(form\)/);
 assert.match(ui,/entityRef\.current:payerRef\.current/);
 assert.match(ui,/className="perseus-stepper"/);
 assert.match(ui,/aria-current=\{step===item\.id\?'step':undefined\}/);
 assert.match(ui,/item\.id==='analysis'\?<span/);
 assert.match(ui,/Após importação/);
 assert.match(ui,/Continuar para arquivo/);
 assert.match(ui,/Selecionar arquivo/);
 assert.doesNotMatch(ui,/Análise manual/);
 assert.doesNotMatch(ui,/Observação|<textarea/);
 assert.match(ui,/uploadInsuranceDocument\(file,\{\.\.\.form,notes:''\}\)/);
 assert.match(ui,/function resetDrawer\(\)\{setFile\(null\);setStep\('context'\);\}/);
 assert.match(ui,/disabled=\{busy\}/);
 assert.match(ui,/<PerseusMark size=\{38\} className="perseus-floating-mark"\/><span>Importar com Perseu<\/span>/);
 assert.match(ui,/fileSize\(file\.size\)/);
 assert.match(css,/\.rn-hub:has\(\.perseus-floating-action\) \.billing-main\{padding-bottom:116px\}/);
 assert.match(css,/\.perseus-drawer-panel\{[^}]*width:min\(620px,100vw\)[^}]*overflow-x:hidden/);
 assert.match(css,/\.perseus-form-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);gap:16px\}/);
 assert.match(css,/\.perseus-floating-mark,.perseus-drawer-mark,.perseus-status img,.perseus-analysis-mark\{[^}]*border:0!important[^}]*border-radius:0!important/);
 assert.match(css,/\.perseus-form-grid\{grid-template-columns:1fr\}/);
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

