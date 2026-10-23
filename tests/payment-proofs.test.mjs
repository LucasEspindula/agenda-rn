import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadTs} from './load-ts.mjs';

test('payment proof status is derived only from current ready attachments',()=>{
 const {paymentProofLabel}=loadTs('components/payment-proofs.tsx',{'@/lib/financial-events':{notifyFinancialChange(){}}});
 const invoice='11111111-1111-4111-8111-111111111111';
 assert.equal(paymentProofLabel([],invoice),'Pago · Sem comprovante');
 assert.equal(paymentProofLabel([{id:'a',invoice_id:invoice,billing_record_id:null,status:'READY',is_current:true}],invoice),'Pago · Comprovante anexado');
 assert.equal(paymentProofLabel([{id:'a',invoice_id:invoice,billing_record_id:null,status:'READY',is_current:false}],invoice),'Pago · Sem comprovante');
 assert.equal(paymentProofLabel([{id:'a',invoice_id:invoice,billing_record_id:null,status:'PENDING',is_current:false}],invoice),'Pago · Sem comprovante');
});

test('payment proof migration keeps the target XOR, private storage and reversal history',async()=>{
 const migration=await readFile('supabase/migrations/20261001193000_financial_payment_proofs.sql','utf8');
 assert.match(migration,/check\(\(invoice_id is null\) <> \(billing_record_id is null\)\)/);
 assert.match(migration,/values\('financial-documents','financial-documents',false,10485760/);
 assert.match(migration,/deactivation_reason text check\(deactivation_reason in \('REPLACED','PAYMENT_REVERSED'\)\)/);
 assert.match(migration,/old\.payment_status='PAGO' and new\.payment_status='PENDENTE'/);
 assert.match(migration,/old\.paid_at is not null and new\.paid_at is null/);
 assert.doesNotMatch(migration,/storage_path'.*financial_log_changes/s);
});

test('attachment endpoint validates file metadata, cleans PENDING uploads and keeps storage paths server-side',async()=>{
 const route=await readFile('app/api/financial-attachments/route.ts','utf8');
 const data=await readFile('lib/billing-data.ts','utf8');
 const client=await readFile('lib/financial-attachments-client.ts','utf8');
 assert.match(route,/const BUCKET='financial-documents',MAX_SIZE=10\*1024\*1024/);
 assert.match(route,/expectedMime\(name\)!==mime/);
 assert.match(route,/bytesMatch\(bytes,meta\.data\.mime_type\)/);
 assert.match(route,/session\.account\.role==='doctor'/);
 assert.match(route,/createSignedUrl\(attachment\.storage_path,60\)/);
 assert.match(route,/export const DELETE=secureMutation/);
 assert.match(route,/attachment\.status!=='PENDING'/);
 assert.match(route,/cleanOldPending\(session\)/);
 assert.doesNotMatch(route,/Response\.json\(\{[^}]*storage_path/s);
 assert.doesNotMatch(data,/allRows\('financial_attachments'\)(?!,)/);
 assert.doesNotMatch(data,/attachmentColumns=.*storage_path/);
 assert.match(client,/cleanupPendingFinancialAttachment/);
});

test('proof UI and Agenda defer upload until the payment is saved and retry only uploads',async()=>{
 const component=await readFile('components/payment-proofs.tsx','utf8');
 const billing=await readFile('app/billing/billing-client.tsx','utf8');
 const agenda=await readFile('public/legacy-app.js','utf8');
 assert.match(component,/Será enviado após salvar o pagamento/);
 assert.match(component,/onPendingFileChange/);
 assert.match(billing,/const target\s*=\s*editing\s*===\s*"record"/);
 assert.match(billing,/await uploadFinancialAttachment\(proofFile!,\s*target!\)/);
 assert.match(billing,/Tentar novamente/);
 assert.match(agenda,/showProofs=f\.draft\.payment_status==='PAGO'/);
 assert.match(agenda,/f\.proofFile=file/);
 assert.match(agenda,/const proofFile=f\.proofFile,proofTargetId=f\.proofTargetId,proofReplacesId=f\.proofReplacesId/);
 assert.match(agenda,/f\.proofFile=proofFile;f\.proofTargetId=proofTargetId;f\.proofReplacesId=proofReplacesId/);
 assert.match(agenda,/await window\.RNFinance\.uploadPaymentProof\(result\.id,f\.proofFile,f\.proofReplacesId\)/);
 assert.match(agenda,/retryNativePaymentProof/);
 const retry=agenda.slice(agenda.indexOf("if($('retryNativePaymentProof'))"),agenda.indexOf('\n}',agenda.indexOf("if($('retryNativePaymentProof'))")));
 assert.doesNotMatch(retry,/fetch\('\/api\/billing'/);
 assert.match(billing,/setMessage\(\s*shouldUpload \? "Pagamento e comprovante salvos\." : "Alteração salva\."/);
 assert.match(billing,/setMessage\("Pagamento salvo\. O comprovante não foi enviado\."\)/);
});

test('SQL and API derive anesthetist access from the canonical appointment state',async()=>{
 const migration=await readFile('supabase/migrations/20261002195405_fix_financial_attachment_agenda_authorization.sql','utf8');
 const route=await readFile('app/api/financial-attachments/route.ts','utf8');
 const data=await readFile('lib/billing-data.ts','utf8');
 assert.doesNotMatch(migration,/a\.anesthetist_id/);
 assert.match(migration,/jsonb_array_elements\(coalesce\(s\.payload->'appointments'/);
 assert.match(migration,/ap\.value->>'anesthetistId'/);
 assert.match(route,/\[row\.doctor_id,row\.anesthetist_id\]/);
 assert.match(data,/const appointment=\(state\.appointments\|\|\[\]\)\.find/);
 assert.match(data,/anesthetist_id:appointment\?\.anesthetistId\|\|''/);
 assert.match(migration,/and not exists\(/);
 assert.match(migration,/grant execute.*service_role/);
});


test('doctor projection exposes only safe current proof metadata and read authorization follows it',()=>{
 const {doctorBillingProjection,doctorCanReadFinancialAttachment}=loadTs('lib/billing-projection.ts');
 const own= {id:'i-own',billing_entity_id:'e',payer:'Convênio',issue_date:'2026-10-01',paid_at:'2026-10-02'};
 const shared={id:'i-shared',billing_entity_id:'e',payer:'Convênio',issue_date:'2026-10-01',paid_at:'2026-10-02'};
 const data={rows:[
  {attendance_id:'a1',doctor_id:'d1',anesthetist_id:'',insurance:'Convênio',record:{id:'r1',billing_entity_id:'e'},invoice:own},
  {attendance_id:'a2',doctor_id:'d2',anesthetist_id:'',insurance:'Convênio',record:{id:'r2',billing_entity_id:'e'},invoice:shared},
 ],items:[
  {invoice_id:'i-own',billing_record_id:'r1'},
  {invoice_id:'i-shared',billing_record_id:'r1'},
  {invoice_id:'i-shared',billing_record_id:'r2'},
 ],invoices:[own,shared],entities:[],doctors:[{id:'d1',name:'Médico'},{id:'d2',name:'Outro'}],links:[],expenses:[],associates:[],payers:[],attachments:[
  {id:'record-own',document_type:'PAYMENT_PROOF',invoice_id:null,billing_record_id:'r1',original_filename:'own.pdf',mime_type:'application/pdf',file_size:1,status:'READY',is_current:true,deactivated_at:null},
  {id:'record-other',document_type:'PAYMENT_PROOF',invoice_id:null,billing_record_id:'r2',original_filename:'other.pdf',mime_type:'application/pdf',file_size:1,status:'READY',is_current:true,deactivated_at:null},
  {id:'invoice-own',document_type:'PAYMENT_PROOF',invoice_id:'i-own',billing_record_id:null,original_filename:'invoice.pdf',mime_type:'application/pdf',file_size:1,status:'READY',is_current:true,deactivated_at:null},
  {id:'invoice-shared',document_type:'PAYMENT_PROOF',invoice_id:'i-shared',billing_record_id:null,original_filename:'shared.pdf',mime_type:'application/pdf',file_size:1,status:'READY',is_current:true,deactivated_at:null},
  {id:'pending',document_type:'PAYMENT_PROOF',invoice_id:null,billing_record_id:'r1',original_filename:'pending.pdf',mime_type:'application/pdf',file_size:1,status:'PENDING',is_current:true,deactivated_at:null},
 ]};
 const principal={account:{id:7,role:'doctor',doctorId:'d1'},agendaIds:['d1'],services:{billing_enabled:true,invoice_enabled:true,scheduling_enabled:true}};
 const projected=doctorBillingProjection(data,principal,true);
 assert.deepEqual(projected.attachments.map(a=>a.id).sort(),['invoice-own','record-own']);
 assert.equal(projected.attachments.some(a=>'storage_path' in a),false);
 const byId=id=>data.attachments.find(a=>a.id===id);
 assert.equal(doctorCanReadFinancialAttachment(data,principal,byId('record-own')),true);
 assert.equal(doctorCanReadFinancialAttachment(data,principal,byId('invoice-own')),true);
 assert.equal(doctorCanReadFinancialAttachment(data,principal,byId('record-other')),false);
 assert.equal(doctorCanReadFinancialAttachment(data,principal,byId('invoice-shared')),false);
 assert.equal(doctorCanReadFinancialAttachment(data,principal,byId('pending')),false);
});

test('attachment GET uses dedicated doctor read authorization while mutations remain forbidden',async()=>{
 const route=await readFile('app/api/financial-attachments/route.ts','utf8');
 assert.match(route,/async function canReadFinancialAttachment/);
 assert.match(route,/doctorCanReadFinancialAttachment\(data,session,attachment\)/);
 assert.match(route,/const doctorRead=session\.account\.role==='doctor'/);
 assert.match(route,/session\.account\.role==='doctor'\)throw new HttpError\(403,'Acesso negado\.'\);/);
});
