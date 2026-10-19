import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {loadTs} from "./load-ts.mjs";
const {includeArchivedCancellations}=loadTs("lib/billing-cancelled.ts");
const {matchesRow,rowStatus}=loadTs("lib/billing-row.ts");
const {buildReport,individualReceived}=loadTs("lib/billing-reports.ts");
const base={attendance_id:"attendance-1",appointment_id:"agenda-1",patient_id:"patient-1",
 origin:"AGENDA",date:"2026-10-11",time:"",patient:"Paciente fictício",
 doctor_id:"doctor-1",anesthetist_id:"",procedure:"Consulta",insurance:"IPE",
 status_atendimento:"scheduled",forma_cobranca:"CONVENIO",billing_entity_id:"entity-1",
 record:{id:"record-1",billing_entity_id:"entity-1",billing_method:"CONVENIO",payment_status:"PENDENTE"},
 invoice:null,invoice_item:null,created_at:"",updated_at:"",created_by:null,updated_by:null};
const archive=[
 {id:"agenda-1",doctorId:"doctor-1",patientId:"patient-1",date:"2026-10-11",status:"scheduled",
  procedure:"Consulta",insurance:"IPE",cancelReason:"Paciente desistiu"},
 {id:"agenda-2",doctorId:"doctor-1",patientId:"patient-2",date:"2026-10-30",status:"scheduled",
  procedure:"Retorno",forma_cobranca:"PARTICULAR",cancelReason:"Desmarcado"}
];
const links=[{doctor_id:"doctor-1",billing_entity_id:"entity-1",active:true}];
const patients=[{id:"patient-1",name:"Paciente fictício"},{id:"patient-2",name:"Outro fictício"}];
const f={entity:"",doctor:"",insurance:"",patient:"",status:"Cancelado",start:"",end:""};
test("cancelamentos arquivados sobrescrevem o status financeiro defasado e cobrem ausências",()=>{
 const rows=includeArchivedCancellations([base],archive,links,patients);
 assert.equal(rows.length,2);
 assert.equal(rows.filter(r=>rowStatus(r)==="Cancelado").length,2);
 assert.equal(rows[0].record.id,"record-1");
 assert.equal(rows[0].cancellation_reason,"Paciente desistiu");
 assert.equal(rows[1].attendance_id,"cancelled:agenda-2");
 assert.equal(rows[1].record,null);
 assert.equal(rows[1].invoice,null);
 assert.equal(rows[1].billing_entity_id,"entity-1");
 assert.equal(rows[1].patient,"Outro fictício");
 assert.equal(rows.filter(r=>matchesRow(r,f)).length,2);
 assert.equal(rows.filter(r=>matchesRow(r,{...f,start:"2026-10-20"})).length,1);
 assert.equal(individualReceived(rows[1]),null);
});
test("não replica cancelamentos se já há vários itens financeiros, nem atribui empresa ambígua",()=>{
 const duplicates=includeArchivedCancellations([base,{...base,record:{...base.record,id:"record-2"}}],
  [...archive,archive[1]],links,patients);
 assert.equal(duplicates.length,3);
 assert.equal(duplicates.filter(r=>r.appointment_id==="agenda-1").length,2);
 const ambiguous=includeArchivedCancellations([],archive.slice(1),
  [...links,{doctor_id:"doctor-1",billing_entity_id:"entity-2",active:false}],patients);
 assert.equal(ambiguous[0].billing_entity_id,null);
});
test("cancelamentos podem ser filtrados no relatório, mas não somam aos recebimentos",()=>{
 const rows=includeArchivedCancellations([base],archive,links,patients);
 const data={rows,doctors:[{id:"doctor-1"}],entities:[{id:"entity-1"}],
  links,invoices:[],items:[],expenses:[]};
 const cancelled=buildReport(data,{kind:"filtered",...f});
 assert.equal(cancelled.rows.length,2);
 assert.equal(cancelled.summary.received,0);
 assert.equal(buildReport(data,{kind:"filtered",...f,status:""}).rows.length,0);
});
test("integração lê cancelledAppointments e fechamento soma arquivo clínico sem tocar em pagamentos",()=>{
 const loader=readFileSync("lib/billing-data.ts","utf8");
 const sql=readFileSync("supabase/migrations/20261019233000_archived_agenda_cancellations_in_closing.sql","utf8");
 const ui=readFileSync("app/billing/billing-client.tsx","utf8");
 assert.match(loader,/includeArchivedCancellations\(rows,state\.cancelledAppointments/);
 assert.match(sql,/cancelled_archive/);
 assert.match(sql,/count\(distinct l\.billing_entity_id\)=1/);
 assert.match(sql,/cancelledAppointments/);
 assert.match(ui,/Motivo do cancelamento/);
 assert.match(ui,/r\.status_atendimento !== "cancelled" && <button/);
 assert.doesNotMatch(sql,/(?:update|delete|insert)\s+(?:into\s+)?public\.billing_records/i);
});
