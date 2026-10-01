import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadTs} from './load-ts.mjs';

test('payment proof status is derived only from current ready attachments',()=>{
 const {paymentProofLabel}=loadTs('components/payment-proofs.tsx');
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

test('attachment endpoint validates file metadata and never exposes storage paths in its response contract',async()=>{
 const route=await readFile('app/api/financial-attachments/route.ts','utf8');
 assert.match(route,/const BUCKET='financial-documents',MAX_SIZE=10\*1024\*1024/);
 assert.match(route,/expectedMime\(name\)!==mime/);
 assert.match(route,/bytesMatch\(bytes,meta\.data\.mime_type\)/);
 assert.match(route,/session\.account\.role==='doctor'/);
 assert.match(route,/createSignedUrl\(attachment\.storage_path,60\)/);
 assert.doesNotMatch(route,/Response\.json\(\{[^}]*storage_path/s);
});
