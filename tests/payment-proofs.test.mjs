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

test('proof UI and Agenda defer upload until the payment is saved',async()=>{
 const component=await readFile('components/payment-proofs.tsx','utf8');
 const billing=await readFile('app/billing/billing-client.tsx','utf8');
 const agenda=await readFile('public/legacy-app.js','utf8');
 assert.match(component,/Será enviado após salvar o pagamento/);
 assert.match(component,/onPendingFileChange/);
 assert.match(billing,/const target=editing==='record'/);
 assert.match(billing,/await uploadFinancialAttachment\(proofFile!,target!\)/);
 assert.match(billing,/Tentar novamente/);
 assert.match(agenda,/showProofs=f\.draft\.payment_status==='PAGO'/);
 assert.match(agenda,/f\.proofFile=file/);
 assert.match(agenda,/await window\.RNFinance\.uploadPaymentProof\(result\.id,f\.proofFile,f\.proofReplacesId\)/);
});

test('secretary authorization also covers anesthetist agendas and shared invoices remain all-or-nothing',async()=>{
 const migration=await readFile('supabase/migrations/20261002191946_refine_financial_payment_proofs.sql','utf8');
 assert.match(migration,/g\.professional_id=a\.doctor_id or g\.professional_id=a\.anesthetist_id/);
 assert.match(migration,/and not exists\(/);
 assert.match(migration,/grant execute.*service_role/);
});
