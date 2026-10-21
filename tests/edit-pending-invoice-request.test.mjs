import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(path,"utf8");
const sql=read("supabase/migrations/20261021203000_edit_pending_invoice_request.sql");
const api=read("app/api/billing/route.ts");
const editor=read("components/invoice-request-editor.tsx");
const list=read("app/billing/invoice-requests.tsx");
const client=read("app/billing/billing-client.tsx");
const agenda=read("public/legacy-app.js");
const bridge=read("app/dashboard/legacy-app.tsx");

test("atualiza exatamente o mesmo pedido, preservando snapshots financeiros e historico",()=>{
 assert.match(sql,/create or replace function public.update_pending_invoice_request/);
 assert.match(sql,/where id=request_row.id/);
 assert.match(sql,/return request_row.id/);
 assert.match(sql,/if request_row.status<>'PENDING' or request_row.invoice_id is not null/);
 assert.match(sql,/request_row.updated_at is distinct from expected/);
 assert.match(sql,/linked.received_amount is distinct from request_row.received_amount_snapshot/);
 assert.match(sql,/linked.paid_at is distinct from request_row.paid_at_snapshot/);
 assert.match(sql,/perform public.financial_operation\(p_actor,'edit_invoice_request'/);
 assert.match(sql,/set taker_kind=kind,taker_name=name,taker_tax_id=cpf,taker_address=address_value,notes=note_value/);
 assert.doesNotMatch(sql,/insert into public.invoice_requests|delete from public.invoice_requests/i);
});
test("trigger permite alterar so dados do tomador de pedido pendente e nao permitir NF emitida",()=>{
 assert.match(sql,/old.status<>'PENDING' or new.status<>'PENDING'/);
 assert.match(sql,/old.invoice_id is not null or new.invoice_id is not null/);
 assert.match(sql,/to_jsonb\(new\)-array\['taker_kind','taker_name','taker_tax_id','taker_address','notes','updated_at','updated_by'\]/);
 assert.match(sql,/Snapshot fiscal imutável/);
 assert.match(sql,/Preserve o histórico da solicitação fiscal/);
 assert.match(sql,/grant execute on function public.update_pending_invoice_request\(bigint,jsonb\) to service_role/);
});
test("API permite secretaria somente pela autorizacao validada no banco",()=>{
 assert.match(api,/edit_invoice_request'\].includes\(kind\)/);
 assert.match(api,/!\['record','professional_charge','edit_invoice_request'\].includes\(kind\)/);
 assert.match(api,/kind==='edit_invoice_request'\?'update_pending_invoice_request'/);
 assert.match(sql,/actor_role='secretary' and not exists/);
 assert.match(sql,/public.agenda_access/);
 assert.match(api,/if\(!appointmentId\)data.requests=/);
});
test("interface nao cria segunda solicitacao e pede versao para impedir sobrescrita",()=>{
 assert.match(editor,/kind:"edit_invoice_request"/);
 assert.match(editor,/updated_at:request.updated_at/);
 assert.match(editor,/id:request.id/);
 assert.match(editor,/solicitação de NF/i);
 assert.match(editor,/validCPF\(form.taker_tax_id\)/);
 assert.match(editor,/onSaved\(\)/);
 assert.match(list,/Editar solicitação/);
 assert.match(list,/onEdit\(r\)/);
 assert.match(client,/setEditingRequest\(r\)|onEdit=\{setEditingRequest\}/);
});
test("edicao tambem e acessivel nos detalhes do agendamento para solicitacoes PENDING",()=>{
 assert.match(bridge,/editPendingInvoiceRequest/);
 assert.match(agenda,/id="nativeEditInvoiceRequest"/);
 assert.match(agenda,/window.RNFinance.editPendingInvoiceRequest\(pendingRequest\)/);
 assert.match(agenda,/r.status==='PENDING'&&!r.invoice_id/);
});
