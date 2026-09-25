import {isInsurancePending,matchesRow,matchesInvoice,rowEntityId} from './billing-row';
import type {BillingData,BillingRow} from './billing-types';
export function individualReceived(row:BillingRow):number|null {
 const value=(row.invoice&&row.invoice.recipient_type!=='PARTICULAR')||((row.forma_cobranca||row.record?.billing_method)==='CONVENIO'&&row.record?.settlement_mode!=='DIRECT')?row.invoice_item?.received_amount:row.record?.received_amount;
 return value==null?null:Number(value);
}
export function summarize(rows:BillingRow[]) {
 const paid=rows.filter(r=>r.invoice&&r.invoice.recipient_type!=='PARTICULAR'?!!r.invoice.paid_at:r.record?.payment_status==='PAGO').length;
 return {total:rows.length,private:rows.filter(r=>(r.forma_cobranca||r.record?.billing_method)==='PARTICULAR').length,insurance:rows.filter(r=>(r.forma_cobranca||r.record?.billing_method)==='CONVENIO').length,paid,pending:rows.length-paid,received:rows.reduce((c,r)=>c+Math.round((individualReceived(r)??0)*100),0)/100,unidentified:rows.filter(r=>individualReceived(r)==null).length};
}
export type ReportScope={kind:'filtered'|'doctor'|'entity'|'invoices'|'pending';doctor:string;entity:string;start:string;end:string;insurance?:string;status?:string;issued_at?:string};
export function buildReport(data:BillingData,scope:ReportScope){
 if((['doctor','entity'].includes(scope.kind)&&(!scope.start||!scope.end))||(scope.start&&scope.end&&scope.start>scope.end))throw new Error('Selecione um período válido para o relatório.');
 if(scope.kind==='doctor'&&!data.doctors.some(d=>d.id===scope.doctor))throw new Error('Selecione o médico para gerar o relatório.');
 if(scope.kind==='entity'&&!data.entities.some(e=>e.id===scope.entity))throw new Error('Selecione a empresa para gerar o relatório.');
 const rows=data.rows.filter(r=>(scope.kind==='filtered'||r.status_atendimento==='realized')&&matchesRow(r,scope)&&(scope.kind!=='pending'||isInsurancePending(r))).sort((a,b)=>a.date.localeCompare(b.date)||a.patient.localeCompare(b.patient));
 const invoices=data.invoices.filter(i=>matchesInvoice(i,data,scope));
 const groups=[...new Set(rows.map(r=>scope.kind==='doctor'?rowEntityId(r):r.doctor_id))].map(id=>{
  const items=rows.filter(r=>(scope.kind==='doctor'?rowEntityId(r):r.doctor_id)===id);
  return {id,rows:items,summary:summarize(items)};
 });
 return {rows,groups,invoices,summary:summarize(rows),cash:scope.kind==='entity'&&!scope.status&&!scope.doctor&&!scope.insurance?companyCash(data,scope.entity,scope.start,scope.end):null};
}

export function companyCash(data:BillingData,entity:string,start:string,end:string){
 const within=(date:string|null|undefined)=>!!date&&date>=start&&date<=end;
 const direct=data.rows.filter(r=>r.record?.billing_entity_id===entity&&(!r.invoice||r.invoice.recipient_type==='PARTICULAR')&&r.record.payment_status==='PAGO'&&(r.record.billing_method==='PARTICULAR'||r.record.settlement_mode==='DIRECT')&&within(r.record.paid_at));
 const invoices=[...new Map(data.invoices.filter(i=>i.recipient_type!=='PARTICULAR'&&i.billing_entity_id===entity&&within(i.paid_at)).map(i=>[i.id,i])).values()];
 const expenses=(data.expenses||[]).filter(e=>e.billing_entity_id===entity&&e.status==='PAGO'&&within(e.paid_at));
 const sum=(values:(number|null)[])=>values.reduce<number>((n,v)=>n+Math.round(Number(v??0)*100),0)/100;
 const revenue=sum([...direct.map(r=>r.record!.received_amount),...invoices.map(i=>i.net_amount)]),paidExpenses=sum(expenses.map(e=>e.amount));
 return {revenue,paidExpenses,result:Math.round((revenue-paidExpenses)*100)/100,unknownInvoices:invoices.filter(i=>i.net_amount==null).length,invoiceCount:invoices.length,expenses};
}

