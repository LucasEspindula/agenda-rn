import type {BillingData,BillingRow} from './billing-types';
export function individualReceived(row:BillingRow):number|null {
 const value=(row.forma_cobranca||row.record?.billing_method)==='CONVENIO'?row.invoice_item?.received_amount:row.record?.received_amount;
 return value==null?null:Number(value);
}
export function summarize(rows:BillingRow[]) {
 const paid=rows.filter(r=>r.invoice?!!r.invoice.paid_at:r.record?.payment_status==='PAGO').length;
 return {total:rows.length,private:rows.filter(r=>(r.forma_cobranca||r.record?.billing_method)==='PARTICULAR').length,insurance:rows.filter(r=>(r.forma_cobranca||r.record?.billing_method)==='CONVENIO').length,paid,pending:rows.length-paid,received:rows.reduce((c,r)=>c+Math.round((individualReceived(r)??0)*100),0)/100,unidentified:rows.filter(r=>individualReceived(r)==null).length};
}
export type ReportScope={kind:'doctor'|'entity';doctor:string;entity:string;start:string;end:string};
export function buildReport(data:BillingData,scope:ReportScope){
 if(!scope.start||!scope.end||scope.start>scope.end)throw new Error('Selecione um período válido para o relatório.');
 if(scope.kind==='doctor'&&!data.doctors.some(d=>d.id===scope.doctor))throw new Error('Selecione o médico para gerar o relatório.');
 if(scope.kind==='entity'&&!data.entities.some(e=>e.id===scope.entity))throw new Error('Selecione a empresa para gerar o relatório.');
 const rows=data.rows.filter(r=>r.status_atendimento==='realized'&&r.date>=scope.start&&r.date<=scope.end&&(scope.kind==='entity'?r.record?.billing_entity_id===scope.entity:([r.doctor_id,r.anesthetist_id].includes(scope.doctor)&&(!scope.entity||r.record?.billing_entity_id===scope.entity)))).sort((a,b)=>a.date.localeCompare(b.date)||a.patient.localeCompare(b.patient));
 const groups=[...new Set(rows.map(r=>scope.kind==='doctor'?r.record?.billing_entity_id||'':r.doctor_id))].map(id=>{
  const items=rows.filter(r=>(scope.kind==='doctor'?r.record?.billing_entity_id||'':r.doctor_id)===id);
  return {id,rows:items,summary:summarize(items)};
 });
 return {rows,groups,summary:summarize(rows)};
}
