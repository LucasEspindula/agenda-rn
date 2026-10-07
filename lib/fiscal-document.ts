import {cents} from './fiscal-money';
import type {BillingData,Invoice} from './billing-types';
export const activeInvoice=(i:Invoice)=>!i.voided_at&&(!i.status||i.status==='ACTIVE');
export const historicalInvoice=(i:Invoice)=>!i.voided_at;
export const compareInvoiceNumbersDesc=(a:Invoice,b:Invoice)=>b.invoice_number.localeCompare(a.invoice_number,'pt-BR',{numeric:true,sensitivity:'base'})||String(b.issue_date||'').localeCompare(String(a.issue_date||''))||String(b.id).localeCompare(String(a.id));
export const fiscalStatus=(i:Invoice)=>i.voided_at?'Lançamento desfeito':i.status==='CANCELLED'?'Cancelada':i.status==='REPLACED'?'Substituída':'Ativa';
export function invoiceSources(i:Invoice,data:BillingData){
 const items=data.items.filter(x=>x.invoice_id===i.id);
 const rows=data.rows.filter(r=>items.some(x=>x.billing_record_id===r.record?.id));
 return {payer:i.recipient_type==='PARTICULAR'?i.recipient_name||i.patient_name_snapshot||i.payer:i.payer,
 procedures:[...new Set(rows.map(r=>r.procedure))],issuedBy:data.users?.find(u=>u.id===i.created_by)?.name||'Não informado',
 adjustment:activeInvoice(i)?i.closing_adjustment||0:0,
 doctors:[...new Set(rows.map(r=>r.doctor_id))].map(id=>({id,amount:activeInvoice(i)?rows.filter(r=>r.doctor_id===id).reduce((sum,r)=>sum+cents(Number(items.find(x=>x.billing_record_id===r.record?.id)?.received_amount||0)),0)/100:0}))};
}
