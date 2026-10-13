import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';

const read=(path)=>readFileSync(path,'utf8');
const control=loadTs('lib/insurance-control.ts');
const workspace=loadTs('app/billing/insurance-control.ts');

const documents=[
 {id:'one',originalFilename:'unimed-outubro.csv',detectedFormat:'CSV',uploadStatus:'READY',perseusStatus:'NOT_ANALYZED',createdAt:'2026-10-13T10:00:00Z',importer:'Lucas',rejectionReason:null,analysis:null,movement:{payer:'Unimed',competence:'2026-10-01',kind:'UNKNOWN',external_reference:'PROTO-1',billing_entity:{name:'Clínica Central',trade_name:null}}},
 {id:'two',originalFilename:'bradesco.xml',detectedFormat:'XML',uploadStatus:'READY',perseusStatus:'REVIEW_REQUIRED',createdAt:'2026-10-12T10:00:00Z',importer:'Roseni',rejectionReason:null,analysis:null,movement:{payer:'Bradesco',competence:null,kind:'UNKNOWN',external_reference:null,billing_entity:{name:'Hospital Norte',trade_name:'Norte'}}}
];
const entities=[{id:'central',name:'Clínica Central',trade_name:null},{id:'norte',name:'Hospital Norte',trade_name:'Norte'}];

test('Perseu keeps document lifecycle isolated from financial records',()=>{
 assert.equal(control.canManageInsurance('general_manager'),true);
 assert.equal(control.canManageInsurance('doctor'),false);
 assert.equal(control.insuranceDocumentState('PENDING').label,'Upload pendente');
 const migration=read('supabase/migrations/20261009153000_insurance_control_perseus_foundation.sql');
 assert.doesNotMatch(migration,/alter table public\.(billing_records|invoices|invoice_billing_records)/);
 assert.doesNotMatch(read('app/billing/insurance-control.tsx'),/billing_records|invoice_billing_records|attendances/);
});

test('Perseu validates Contexto before the file step',()=>{
 assert.equal(workspace.perseusContextError({billingEntityId:'',payer:'UNIMED'}),'billingEntityId');
 assert.equal(workspace.perseusContextError({billingEntityId:'entity',payer:'   '}),'payer');
 assert.equal(workspace.perseusContextError({billingEntityId:'entity',payer:'UNIMED'}),null);
});

test('workspace filters search, entity and detected format without a new API',()=>{
 assert.deepEqual(workspace.filterPerseusDocuments(documents,{query:'proto-1',entityId:'',format:''},entities).map(item=>item.id),['one']);
 assert.deepEqual(workspace.filterPerseusDocuments(documents,{query:'',entityId:'norte',format:''},entities).map(item=>item.id),['two']);
 assert.deepEqual(workspace.filterPerseusDocuments(documents,{query:'',entityId:'',format:'CSV'},entities).map(item=>item.id),['one']);
 assert.equal(workspace.selectedPerseusDocument(documents,'two')?.id,'two');
 assert.equal(workspace.selectedPerseusDocument(documents,'missing')?.id,'one');
 assert.equal(workspace.selectedPerseusDocument([], 'missing'),null);
});

test('Convênios exposes Perseu as the visible workspace tab',()=>{
 const billing=read('app/billing/billing-client.tsx');
 assert.match(billing,/useState<'pending'\|'documents'>\('documents'\)/);
 assert.match(billing,/>Perseu<\/button>/);
 assert.doesNotMatch(billing,/>Documentos<\/button>/);
 assert.match(billing,/<InsuranceControl data=\{data\} view=\{insuranceView\}/);
});

test('Perseu reproduces the compact master-detail workspace',()=>{
 const ui=read('app/billing/insurance-control.tsx');
 const css=read('app/billing/billing.css');
 assert.match(ui,/className="perseus-workspace"/);
 assert.match(ui,/perseus-workspace-body/);
 assert.match(ui,/className="perseus-document-list"/);
 assert.match(ui,/className="perseus-document-detail"/);
 assert.doesNotMatch(ui,/perseus-detail-extra/);
 assert.doesNotMatch(ui,/entityLabel\(selected\.movement\.billing_entity\).*formatDateTimeBR\(selected\.createdAt\).*selected\.importer/);
 assert.match(ui,/className="perseus-list-toolbar"/);
 assert.match(ui,/value=\{filters\.query\}/);
 assert.match(ui,/value=\{filters\.entityId\}/);
 assert.match(ui,/value=\{filters\.format\}/);
 assert.match(ui,/selectedPerseusDocument\(visibleDocuments,selectedId\)/);
 assert.match(ui,/Convênio \/ Pagador/);
 assert.match(ui,/Importar documento/);
 assert.match(ui,/className="perseus-summary-inline"/);
 assert.doesNotMatch(ui,/PAYER/);
 assert.doesNotMatch(ui,/perseus-floating-action/);
 assert.doesNotMatch(ui,/perseus-drawer/);
 assert.doesNotMatch(css,/\.perseus-floating-action/);
 assert.doesNotMatch(css,/\.perseus-drawer/);
 assert.doesNotMatch(css,/\.perseus-stepper/);
 assert.doesNotMatch(css,/height:calc\(100dvh - 138px\)|min-height:calc\(100dvh - 230px\)/);
 assert.match(css,/\.rn-hub:has\(\.perseus-workspace\)\{[^}]*height:100dvh[^}]*min-height:0[^}]*overflow:hidden/);
 assert.match(css,/\.billing-main:has\(\.perseus-workspace\)\{[^}]*flex:1 1 auto[^}]*min-height:0[^}]*overflow:hidden/);
 assert.match(css,/\.perseus-workspace-body\{[^}]*grid-template-columns:minmax\(0,1fr\) 382px[^}]*min-height:0/);
 assert.equal((css.match(/\.perseus-workspace-header\{/g)||[]).length,0);
 assert.equal((css.match(/\.perseus-workspace-brand\{/g)||[]).length,0);
 assert.equal((css.match(/\.perseus-indicators\{/g)||[]).length,0);
 assert.match(css,/\.perseus-list-scroll\{[^}]*flex:1 1 auto[^}]*overflow-x:hidden[^}]*overflow-y:auto/);
 assert.match(css,/\.perseus-document-detail\{[^}]*display:flex[^}]*flex-direction:column[^}]*min-height:0[^}]*overflow:hidden/);
 assert.match(css,/\.perseus-detail-body\{[^}]*flex:1 1 auto[^}]*min-height:0[^}]*overflow:visible/);
 assert.match(css,/\.perseus-document-detail>footer\{[^}]*flex:0 0 auto/);
 assert.match(css,/\.perseus-original-file strong\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
 assert.match(css,/\.perseus-compact-header\{[^}]*padding-left:18px[^}]*padding-right:18px/);
 assert.match(css,/\.perseus-detail-body\{[^}]*gap:14px[^}]*padding:16px 20px[^}]*overflow:visible/);
 assert.doesNotMatch(css,/\.perseus-detail-extra\{/);
});

test('workspace uses real document fields and preserves current actions',()=>{
 const ui=read('app/billing/insurance-control.tsx');
 assert.match(ui,/document\.detectedFormat/);
 assert.match(ui,/insuranceMovementLabels\[selected\.movement\.kind\]/);
 assert.match(ui,/Abrir original/);
 assert.match(ui,/Baixar original/);
 assert.match(ui,/Analisar com Perseu/);
 assert.match(ui,/Reanalisar com Perseu/);
 assert.match(ui,/Tentar novamente com Perseu/);
 assert.match(ui,/Cancelar importação/);
 assert.match(ui,/Ver prévia estruturada/);
 assert.match(ui,/href=\{url\}/);
});

test('preview and cancellation actions are kept in the inspector footer',()=>{
 const ui=read('app/billing/insurance-control.tsx');
 const footer=ui.slice(ui.indexOf('<footer>{action&&'));
 const body=ui.slice(ui.indexOf('className="perseus-detail-body"'),ui.indexOf('</div><footer>{action&&'));
 assert.match(footer,/Ver prévia estruturada/);
 assert.match(footer,/Cancelar importação/);
 assert.doesNotMatch(body,/Ver prévia estrutural/);
 assert.match(ui,/className="perseus-meta-grid"/);
 assert.match(ui,/onClick=\{\(\)=>setDetailOpen\(false\)\}/);
});

test('header import uses a conventional dialog and preserves the validated two-step flow',()=>{
 const ui=read('app/billing/insurance-control.tsx');
 assert.match(ui,/perseus-import-button/);
 assert.match(ui,/<dialog ref=\{dialogRef\} className="perseus-import-dialog"/);
 assert.match(ui,/showModal\(\)/);
 assert.match(ui,/function resetImport\(\)\{setFile\(null\);setStep\('context'\);\}/);
 assert.match(ui,/function openImport\(\)\{resetImport\(\);setOpen\(true\);\}/);
 assert.match(ui,/function goToFile\(\)\{if\(busy\)return;const invalid=perseusContextError\(form\)/);
 assert.match(ui,/uploadInsuranceDocument\(file,\{\.\.\.form,notes:''\}\)/);
 assert.match(ui,/Continuar para arquivo/);
 assert.doesNotMatch(ui,/Observação|<textarea/);
 assert.doesNotMatch(ui,/Análise manual/);
});

test('structural preview remains separate and only its table scrolls horizontally',()=>{
 const ui=read('app/billing/insurance-control.tsx');
 const css=read('app/billing/billing.css');
 assert.match(ui,/className="perseus-preview-dialog"/);
 assert.match(ui,/sourceMetadata/);
 assert.match(css,/\.perseus-preview-table-wrap\{[^}]*overflow-x:auto/);
 assert.match(css,/\.perseus-preview-table\{min-width:760px/);
});
