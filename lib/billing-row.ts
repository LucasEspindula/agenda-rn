import {activeInvoice,fiscalStatus} from './fiscal-document';
import type {BillingData,BillingRow,Expense,Invoice} from './billing-types';
export const rowEntityId=(row:BillingRow)=>row.record?.billing_entity_id||row.billing_entity_id||'';
export const companyLabel=(data:BillingData,id:string)=>{const e=data.entities.find(e=>e.id===id);return e?.trade_name||e?.name||'—'};
export function isInsurancePending(row:BillingRow){
 if(row.status_atendimento!=='realized'||billingMethod(row)!=='CONVENIO')return false;
 // Only the operational document resolves an invoice-managed attendance.
 if(row.invoice&&activeInvoice(row.invoice))return !row.invoice.paid_at;
 return !(row.record?.settlement_mode==='DIRECT'&&row.record.payment_status==='PAGO'&&row.record.paid_at&&row.record.received_amount!=null);
}
export const normalizeBillingKey=(value:string|undefined|null)=>String(value||'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
export function attendanceInsuranceOptions(rows:BillingRow[]){const labels=new Map<string,string>();for(const row of rows){const label=String(row.insurance||'').trim(),key=normalizeBillingKey(label),method=billingMethod(row);if(method==='CONVENIO'&&label&&key&&!labels.has(key))labels.set(key,label)}return [...labels.values()].sort((a,b)=>a.localeCompare(b,'pt-BR',{sensitivity:'base'}));}
export function sanitizeAttendanceFilters(rows:BillingRow[],insurance:string,patient:string){const selected=String(insurance||'').trim();if(normalizeBillingKey(selected)==='particular')return {insurance:'PARTICULAR',patient};const option=attendanceInsuranceOptions(rows).find(value=>normalizeBillingKey(value)===normalizeBillingKey(selected));return option?{insurance:option,patient:''}:{insurance:'',patient:''};}
export const billingMethod=(row:BillingRow)=>row.record?.billing_method||row.forma_cobranca||'';
export const billingRowKey=(row:BillingRow)=>row.record?.id||`attendance:${row.attendance_id}`;
const includesPatient=(row:BillingRow,query:string|undefined)=>!query||normalizeBillingKey(row.patient).includes(normalizeBillingKey(query));
export type RowFilters={entity:string;doctor:string;insurance?:string;patient?:string;status?:string;start:string;end:string};
export function matchesRow(row:BillingRow,f:RowFilters){const key=normalizeBillingKey(f.insurance),isPrivate=key==='particular',isInsurance=!!key&&!isPrivate;return (!f.status||rowStatus(row)===f.status)&&(!f.entity||rowEntityId(row)===f.entity)&&(!f.doctor||row.doctor_id===f.doctor)&&(!isPrivate||billingMethod(row)==='PARTICULAR'&&includesPatient(row,f.patient))&&(!isInsurance||billingMethod(row)==='CONVENIO'&&normalizeBillingKey(row.insurance)===key)&&(!f.start||row.date>=f.start)&&(!f.end||row.date<=f.end);}
export function expensePayer(data:BillingData,e:Expense){const link=data.links.find(l=>l.id===e.paid_by_doctor_entity_link_id);return data.doctors.find(d=>d.id===link?.doctor_id)?.name||data.associates?.find(a=>a.id===e.paid_by_associate_id)?.name||'—';}

export const ROW_STATUSES=['Cancelado','Não configurado','Pendente','Pendente sem NF','Aguardando pagamento','Pago'];
export const INVOICE_STATUSES=['Aguardando pagamento','Pago','Cancelada','Substituída'];
export const invoiceStatus=(i:Invoice)=>!activeInvoice(i)?fiscalStatus(i):i.paid_at?'Pago':'Aguardando pagamento';
export const rowStatus=(r:BillingRow)=>r.status_atendimento==='cancelled'?'Cancelado':(r.invoice&&r.invoice.recipient_type!=='PARTICULAR'?!!r.invoice.paid_at:r.record?.payment_status==='PAGO')?'Pago':r.invoice?'Aguardando pagamento':r.record?.settlement_mode==='DIRECT'?'Pendente':r.record?'Pendente sem NF':'Não configurado';
export const matchesInvoice=(i:Invoice,data:BillingData,f:RowFilters)=>(!f.entity||i.billing_entity_id===f.entity)&&(!f.start||i.issue_date>=f.start)&&(!f.end||i.issue_date<=f.end)&&(!f.insurance||normalizeBillingKey(i.payer)===normalizeBillingKey(f.insurance))&&(!f.status||invoiceStatus(i)===f.status)&&(!f.doctor||invoiceRows(i,data).some(({row:r})=>r.doctor_id===f.doctor));

export function invoiceRows(invoice:Invoice,data:BillingData){
 const items=new Map(data.items.filter(item=>item.invoice_id===invoice.id).map(item=>[item.billing_record_id,item]));
 return data.rows.flatMap(row=>{const item=row.record&&items.get(row.record.id);return item?[{row,amount:item.received_amount??null}]:row.invoice?.id===invoice.id?[{row,amount:row.invoice_item?.received_amount??null}]:[]});
}

