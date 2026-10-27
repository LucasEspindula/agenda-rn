import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTs} from './load-ts.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const guard=loadTs('lib/attendance-invoice-status.ts');

const base={attendance_id:'a1',appointment_id:'appt1',patient:'Paciente',status_atendimento:'realized',record:{id:'r1'},invoice:null};
function make({linked=true,status='ACTIVE',shared=false}={}){
 const items=linked?[{invoice_id:'nf1',billing_record_id:'r1',is_active:status==='ACTIVE'}]:[];
 if(shared)items.push({invoice_id:'nf1',billing_record_id:'r2',is_active:true});
 return {rows:[base,...(shared?[{...base,attendance_id:'a2',appointment_id:'appt2',record:{id:'r2'}}]:[])],
   items,invoices:linked?[{id:'nf1',status,voided_at:null,invoice_number:'123'}]:[],requests:[]};
}

test('emitted ACTIVE invoice prevents cancellation for both records in a shared NF',()=>{
 const d=make({shared:true});
 assert.equal(guard.hasIssuedInvoiceForAttendance(d.rows[0],d),true);
 assert.equal(guard.hasIssuedInvoiceForAttendance(d.rows[1],d),true);
 assert.equal(guard.fiscalAttendanceStatus(d.rows[0],d),'Emitida');
 assert.equal(guard.fiscalAttendanceStatus(d.rows[1],d),'Emitida');
});
test('unlinked attendance and cancelled/replaced documents are not considered issued',()=>{
 const none=make({linked:false});
 assert.equal(guard.hasIssuedInvoiceForAttendance(none.rows[0],none),false);
 assert.equal(guard.fiscalAttendanceStatus(none.rows[0],none),'Sem NF');
 for(const status of ['CANCELLED','REPLACED']){
  const d=make({status});
  assert.equal(guard.hasIssuedInvoiceForAttendance(d.rows[0],d),false);
  assert.equal(guard.fiscalAttendanceStatus(d.rows[0],d),status==='CANCELLED'?'Cancelada':'Substituída');
 }
});
test('request pending is distinct from no invoice; all invoice history statuses appear',()=>{
 const d=make({linked:false});
 d.requests=[{attendance_id:'a1',status:'PENDING'}];
 assert.equal(guard.fiscalAttendanceStatus(d.rows[0],d),'Solicitada');
 d.requests=[];
 d.invoices=[{id:'nf1',status:'REPLACED'},{id:'nf2',status:'ACTIVE'},{id:'nf3',status:'CANCELLED'}];
 d.items=[{invoice_id:'nf1',billing_record_id:'r1',is_active:false},
 {invoice_id:'nf2',billing_record_id:'r1',is_active:true},
 {invoice_id:'nf3',billing_record_id:'r1',is_active:false}];
 assert.equal(guard.fiscalAttendanceStatus(d.rows[0],d),'Substituída / Emitida / Cancelada');
 assert.equal(guard.hasIssuedInvoiceForAttendance(d.rows[0],d),true);
});
test('operational status remains separate and matches persisted attendance states',()=>{
 assert.equal(guard.operationalAttendanceStatus(base),'Realizado');
 assert.equal(guard.operationalAttendanceStatus({...base,status_atendimento:'scheduled'}),'Agendado');
 assert.equal(guard.operationalAttendanceStatus({...base,status_atendimento:'cancelled'}),'Cancelado');
});
test('database guards block both agenda and attendance mutations, including direct DELETE',()=>{
 const sql=read('supabase/migrations/20261027120529_guard_issued_invoice_attendance_cancellation.sql');
 assert.match(sql,/CREATE TRIGGER guard_issued_invoice_agenda_cancellation[\s\S]*?BEFORE UPDATE OF payload ON public.app_state/);
 assert.match(sql,/FROM jsonb_array_elements\(coalesce\(OLD.payload->'appointments'/);
 assert.match(sql,/FROM jsonb_array_elements\(coalesce\(NEW.payload->'appointments'/);
 assert.match(sql,/current_appointment->>'status' IS DISTINCT FROM 'cancelled'/);
 assert.match(sql,/b.appointment_id=previous->>'id'/);
 assert.match(sql,/CREATE TRIGGER guard_issued_invoice_attendance_mutation[\s\S]*?BEFORE UPDATE OF status OR DELETE ON public.attendances/);
 assert.match(sql,/b.attendance_id=OLD.id/);
 assert.match(sql,/item.is_active/);
 assert.match(sql,/invoice.status='ACTIVE'/);
 assert.match(sql,/invoice.voided_at IS NULL/);
 assert.match(sql,/pg_advisory_xact_lock\(194701,1\)/);
 assert.match(sql,/ERRCODE='P0001'/);
 assert.doesNotMatch(sql,/DELETE FROM public\.|UPDATE public.invoices/);
});
test('API handles fiscal guard conflicts and UI shows independent statuses on all table breakpoints',()=>{
 const state=read('app/api/state/route.ts'),work=read('app/api/workflow/route.ts'),
       billing=read('app/api/billing/route.ts'),ui=read('app/billing/billing-client.tsx'),
       legacy=read('public/legacy-app.js');
 assert.match(state,/saved.error\?\.code==='P0001'/);
 assert.match(work,/result.error\?\.code==='P0001'/);
 assert.match(billing,/issued_invoice:hasIssuedInvoiceForAttendance\(r,data\)/);
 assert.match(ui,/<th>Status do Atendimento<\/th>\s*<th>Status da NF<\/th>/);
 assert.match(ui,/<td>\s*<span className=\{"billing-badge "\+\(r.status_atendimento/);
 assert.match(ui,/\{operationalAttendanceStatus\(r\)\}/);
 assert.match(ui,/\{fiscalAttendanceStatus\(r,data\)\}/);
 assert.match(ui,/disabled=\{!!r.invoice \|\| hasIssuedInvoiceForAttendance\(r,data\)\}/);
 assert.match(legacy,/financialIssuedAppointments=new Set\(result.rows.filter\(r=>r.issued_invoice\)/);
 assert.match(legacy,/if\(financialIssuedAppointments.has\(id\)\)return appNotice/);
 assert.match(read('components/billing-mobile-tables.tsx'),/data-mobile-label/);
 assert.match(read('app/billing/billing.css'),/table.billing-mobile-card-table/);
});
