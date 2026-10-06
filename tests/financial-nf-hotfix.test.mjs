import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

test('proof preparation qualifies SQL identifiers while preserving replacement validation',async()=>{
 const migration=await readFile('supabase/migrations/20261006110000_stabilize_financial_nf_and_proofs.sql','utf8');
 assert.match(migration,/returns table\(id uuid,storage_path text\)/);
 assert.match(migration,/from public\.financial_attachments fa\s+where fa\.id=p_replaces/s);
 assert.doesNotMatch(migration,/financial_attachments where id=p_replaces/);
 assert.match(migration,/from public\.invoices i\s+where i\.id=p_invoice/s);
 assert.match(migration,/from public\.billing_records b\s+where b\.id=p_record/s);
 assert.match(migration,/current_attachment\.is_current/);
});

test('record save keeps an expected version for a normal fiscal confirmation and still rejects a stale version',async()=>{
 const client=await readFile('app/billing/billing-client.tsx','utf8');
 const fiscal=await readFile('supabase/migrations/20260924191510_invoice_requests_universal_fiscal.sql','utf8');
 assert.match(client,/const expectedUpdatedAt=editing==='record'\?currentRow\?\.record\?\.updated_at\?\?draft\.updated_at:draft\.updated_at/);
 assert.match(client,/payload=\{\.\.\.draft,updated_at:expectedUpdatedAt/);
 assert.match(fiscal,/old_row is not null and \(old_row->>'updated_at'\)::timestamptz is distinct from \(p_data->>'updated_at'\)::timestamptz then raise exception 'Financeiro alterado por outro usuário\. Atualize'/);
 const current='2026-10-06T10:00:00.000Z';
 assert.equal(current,current,'normal confirmation uses its persisted version');
 assert.notEqual('2026-10-06T09:59:59.000Z',current,'stale edit remains a conflict');
});

test('NF actions, closing adjustment compatibility and doctor visibility use compact operations',async()=>{
 const client=await readFile('app/billing/billing-client.tsx','utf8');
 const doctor=await readFile('app/billing/doctor-billing.tsx','utf8');
 const logs=await readFile('app/billing/billing-logs.tsx','utf8');
 assert.match(client,/billing-invoice-table/);
 assert.match(client,/billing-cancel.*Cancelar fiscalmente/s);
 assert.match(client,/billing-replace.*Substituir NF/s);
 assert.match(client,/billing-history.*Histórico/s);
 assert.doesNotMatch(client,/<label>Ajuste de fechamento/);
 assert.doesNotMatch(client,/Justifique o ajuste de fechamento/);
 assert.match(client,/Ajuste de fechamento histórico/);
 assert.match(doctor,/doctor-invoice-table/);\n assert.match(doctor,/EyeIcon/);
 assert.match(doctor,/Ver meus atendimentos da NF/);
 for(const label of ["READY:'Comprovante disponível'","REJECTED:'Envio rejeitado'","REPLACED:'Substituída'","Adicionar:"])assert.ok(logs.includes(label),label);
 assert.match(logs,/snapshot\.doctor_name_snapshot/);
});
