import type {BillingRow,Link} from "./billing-types";

// Os cancelamentos clínicos arquivados na Agenda não possuem status='cancelled'
// obrigatoriamente na tabela de atendimentos do financeiro. Projeção SOMENTE LEITURA:
// nenhum faturamento/nota/recebimento é criado a partir do arquivo clínico.
export type ArchivedCancellation={
 id?:string;patientId?:string;doctorId?:string;anesthetistId?:string;
 date?:string;procedure?:string;insurance?:string;forma_cobranca?:string;
 cancelledAt?:string;cancelReason?:string
};
export function includeArchivedCancellations(
 rows:BillingRow[],
 archived:readonly ArchivedCancellation[],
 links:readonly Link[],
 patients:readonly {id:string;name:string}[]
):BillingRow[]{
 const knownIds=new Set(archived.map(a=>a.id).filter(Boolean));
 const activeRows=rows.map(row=>{
  const item=archived.find(a=>a.id&&a.id===row.appointment_id);
  return item?{...row,status_atendimento:"cancelled",
   cancelled_at:item.cancelledAt||row.cancelled_at||null,
   cancellation_reason:item.cancelReason||row.cancellation_reason||null}:row;
 });
 const existing=new Set(rows.flatMap(row=>[row.appointment_id,row.attendance_id].filter(Boolean)));
 const seen=new Set<string>();
 for(const item of archived){
  const id=String(item.id||"");
  if(!id||seen.has(id)||existing.has(id)||!/^\d{4}-\d{2}-\d{2}$/.test(item.date||""))continue;
  seen.add(id);
  const doctorId=String(item.doctorId||"");
  const entities=[...new Set(links.filter(l=>l.doctor_id===doctorId).map(l=>l.billing_entity_id))];
  const billingEntityId=entities.length===1?entities[0]:null;
  const patient=patients.find(p=>p.id===item.patientId);
  const method=item.forma_cobranca==="PARTICULAR"||item.forma_cobranca==="CONVENIO"?
   item.forma_cobranca:null;
  activeRows.push({
   attendance_id:"cancelled:"+id,appointment_id:id,
   billing_entity_id:billingEntityId,patient_id:item.patientId||null,
   origin:"AGENDA",date:item.date||"",time:"",
   patient:patient?.name||"Paciente histórico",
   doctor_id:doctorId,clinical_doctor_id:doctorId,anesthetist_id:item.anesthetistId||"",
   procedure:item.procedure||"—",insurance:item.insurance||"",
   status_atendimento:"cancelled",forma_cobranca:method,
   cancelled_at:item.cancelledAt||null,cancellation_reason:item.cancelReason||null,
   record:null,invoice:null,invoice_item:null,legacy_payment:null,legacy_invoice:null,
   created_at:"",updated_at:item.cancelledAt||"",created_by:null,updated_by:null
  });
 }
 return activeRows;
}
