import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {loadTs} from './load-ts.mjs';

const {captureFinancialVersion,withExpectedFinancialVersion,financialVersionIsStale}=loadTs('lib/financial-concurrency.ts');

test('proof preparation qualifies SQL identifiers while preserving replacement validation',async()=>{
 const migration=await readFile('supabase/migrations/20261006110000_stabilize_financial_nf_and_proofs.sql','utf8');
 assert.match(migration,/returns table\(id uuid,storage_path text\)/);
 assert.match(migration,/from public\.financial_attachments fa\s+where fa\.id=p_replaces/s);
 assert.doesNotMatch(migration,/financial_attachments where id=p_replaces/);
 assert.match(migration,/from public\.invoices i\s+where i\.id=p_invoice/s);
 assert.match(migration,/from public\.billing_records b\s+where b\.id=p_record/s);
 assert.match(migration,/current_attachment\.is_current/);
});

test('fiscal confirmation accepts the immutable version captured when the record modal opens',()=>{
 const t1='2026-10-06T10:00:00.000Z';
 const openedVersion=captureFinancialVersion(t1);
 const payload=withExpectedFinancialVersion({id:'record-1',updated_at:t1,payment_status:'PAGO',fiscal:{taker_name:'Paciente'}},'record',openedVersion);
 assert.equal(payload.updated_at,t1);
 assert.equal(financialVersionIsStale(t1,payload.updated_at),false);
});

test('a concurrent financial edit remains stale instead of being overwritten',()=>{
 const t1='2026-10-06T10:00:00.000Z';
 const t2='2026-10-06T10:05:00.000Z';
 const payload=withExpectedFinancialVersion({id:'record-1',updated_at:t1,payment_status:'PAGO'},'record',captureFinancialVersion(t1));
 assert.equal(payload.updated_at,t1);
 assert.equal(financialVersionIsStale(t2,payload.updated_at),true);
});

test('a refresh while the modal is open does not adopt the newer current row version',()=>{
 const t1='2026-10-06T10:00:00.000Z';
 const t2='2026-10-06T10:05:00.000Z';
 const openedVersion=captureFinancialVersion(t1);
 const refreshedCurrentRow={updated_at:t2};
 const staleDraft={id:'record-1',updated_at:t1,payment_status:'PAGO'};
 const payload=withExpectedFinancialVersion(staleDraft,'record',openedVersion);
 assert.equal(refreshedCurrentRow.updated_at,t2);
 assert.equal(payload.updated_at,t1);
 assert.equal(financialVersionIsStale(refreshedCurrentRow.updated_at,payload.updated_at),true);
});

test('NF actions preserve historical adjustment on edit and reset it on replacement',async()=>{
 const client=await readFile('app/billing/billing-client.tsx','utf8');
 const css=await readFile('app/billing/billing.css','utf8');
 const legacy=await readFile('public/legacy-app.js','utf8');
 assert.match(client,/setExpectedRecordVersion\([\s\S]{0,100}captureFinancialVersion\(value\.updated_at\)/);
 assert.match(client,/withExpectedFinancialVersion\(\s*\{\s*\.\.\.draft,/);
 assert.match(client,/billing-history.*Histórico/s);
 assert.match(client,/closing_adjustment:\s*0,\s*closing_adjustment_reason:\s*""/);
 assert.match(css,/invoice-row-cancelled:hover>\.billing-actions-cell\{background:#fff7f7\}/);
 assert.match(css,/invoice-row-replaced:hover>\.billing-actions-cell\{background:#fffbed\}/);
 assert.match(legacy,/<span class="workflow-change-label">Adicionar:/);
 assert.match(legacy,/workflow-change-label\">Adicionar:/);
 assert.doesNotMatch(legacy,/ADICIONADO/);
});
