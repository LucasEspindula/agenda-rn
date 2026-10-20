import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync('supabase/migrations/20261020234500_manager_approval_all_fiscal_actions_restore.sql','utf8');
const api=readFileSync('app/api/billing/route.ts','utf8');
const ui=readFileSync('app/billing/billing-client.tsx','utf8');
const privateInvoice=readFileSync('app/billing/private-invoice.tsx','utf8');

test('API exige senha do Gerente Geral para cancelar, substituir, desfazer e reativar, independente do mês',()=>{
 for(const action of ['cancel_invoice','replace_invoice','undo_invoice','restore_invoice'])
  assert.match(api,new RegExp("'"+action+"'"));
 assert.match(api,/manager-fiscal-authorization/);
 assert.match(api,/await verifyPassword\(manager_password/);
 assert.match(api,/manager\.role!=='general_manager'/);
 assert.match(api,/approvedManagerId=manager\.id/);
 assert.match(api,/save_billing_with_manager_approval/);
 assert.doesNotMatch(api,/isInvoiceFromEarlierMonth/);
 assert.doesNotMatch(api,/\bif\(isInvoiceFromEarlierMonth/);
});
test('a transação registra aprovador e operador de qualquer período',()=>{
 assert.match(sql,/p_kind not in \('cancel_invoice','replace_invoice','undo_invoice','restore_invoice'\)/);
 assert.match(sql,/saved_id:=public\.restore_billing_invoice\(p_approver,p_data\)/);
 assert.match(sql,/saved_id:=public\.save_billing\(p_approver,p_kind,p_data\)/);
 assert.match(sql,/insert into public\.financial_log_changes/);
 assert.match(sql,/authorized_by_id/);
 assert.doesNotMatch(sql,/Fluxo de autorização reservado às NFs de meses anteriores/);
});
test('não reativa NF enquanto substituta/atendimento tiver vínculo ativo, não desfaz NF voided',()=>{
 assert.match(sql,/i\.status not in \('CANCELLED','REPLACED'\) or i\.voided_at is not null/);
 assert.match(sql,/i\.replaced_by_invoice_id is not null/);
 assert.match(sql,/next_invoice\.status='ACTIVE'/);
 assert.match(sql,/other_ib\.invoice_id<>i\.id and other_ib\.is_active/);
 assert.match(sql,/NF alterada por outro usuário/);
 assert.match(sql,/status='ACTIVE', cancelled_at=null/);
 assert.match(sql,/update public\.invoice_billing_records/);
 assert.match(sql,/set is_active=true/);
 assert.doesNotMatch(sql,/delete from public\.invoices/);
});
test('tela exige senha para cancelamento e reativação e substituta particular e convênio',()=>{
 assert.match(ui,/askFiscal\("restore_invoice"/);
 assert.match(ui,/Senha atual do Gerente Geral/);
 assert.match(ui,/fiscalPassword\.length<8/);
 assert.match(ui,/manager_password:fiscalPassword/);
 assert.match(ui,/replacement\?\.invoice&&/);
 assert.doesNotMatch(ui,/isInvoiceFromEarlierMonth/);
 assert.match(privateInvoice,/if\(!replacement\)return/);
 assert.match(privateInvoice,/managerPassword\.length<8/);
 assert.doesNotMatch(privateInvoice,/isInvoiceFromEarlierMonth/);
});
