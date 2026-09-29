import {activeInvoice,fiscalStatus} from './fiscal-document';
import type {BillingData,BillingRow,Expense,Invoice} from './billing-types';
export const rowEntityId=(row:BillingRow)=>row.record?.billing_entity_id||row.billing_entity_id||'';
export const companyLabel=(data:BillingData,id:string)=>{const e=data.entities.find(e=>e.id===id);return e?.trade_name||e?.name||'—'};
export function isInsurancePending(row:BillingRow){return row.status_atendimento==='realized'&&row.forma_cobranca==='CONVENIO'&&!(row.invoice?row.invoice.paid_at:row.record?.payment_status==='PAGO');}
export type RowFilters={entity:string;doctor:string;insurance?:string;status?:string;start:string;end:string};
export function matchesRow(row:BillingRow,f:RowFilters){return (!f.status||rowStatus(row)===f.status)&&(!f.entity||rowEntityId(row)===f.entity)&&(!f.doctor||[row.doctor_id,row.anesthetist_id].includes(f.doctor))&&(!f.insurance||row.insurance.trim().toUpperCase()===f.insurance.trim().toUpperCase())&&(!f.start||row.date>=f.start)&&(!f.end||row.date<=f.end);}
export function expensePayer(data:BillingData,e:Expense){const link=data.links.find(l=>l.id===e.paid_by_doctor_entity_link_id);return data.doctors.find(d=>d.id===link?.doctor_id)?.name||data.associates?.find(a=>a.id===e.paid_by_associate_id)?.name||'—';}

export const ROW_STATUSES=['Cancelado','Não configurado','Pendente','Pendente sem NF','Aguardando pagamento','Pago'];
export const INVOICE_STATUSES=['Aguardando pagamento','Pago','Cancelada','Substituída','Lançamento desfeito'];
export const invoiceStatus=(i:Invoice)=>!activeInvoice(i)?fiscalStatus(i):i.paid_at?'Pago':'Aguardando pagamento';
export const rowStatus=(r:BillingRow)=>r.status_atendimento==='cancelled'?'Cancelado':(r.invoice&&r.invoice.recipient_type!=='PARTICULAR'?!!r.invoice.paid_at:r.record?.payment_status==='PAGO')?'Pago':r.invoice?'Aguardando pagamento':r.record?.settlement_mode==='DIRECT'?'Pendente':r.record?'Pendente sem NF':'Não configurado';
export const matchesInvoice=(i:Invoice,data:BillingData,f:RowFilters)=>(!f.entity||i.billing_entity_id===f.entity)&&(!f.start||i.issue_date>=f.start)&&(!f.end||i.issue_date<=f.end)&&(!f.insurance||i.payer.trim().toUpperCase()===f.insurance.trim().toUpperCase())&&(!f.status||invoiceStatus(i)===f.status)&&(!f.doctor||data.rows.some(r=>[r.doctor_id,r.anesthetist_id].includes(f.doctor)&&r.invoice?.id===i.id));

