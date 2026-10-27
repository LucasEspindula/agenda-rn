import type {BillingData,BillingRow} from './billing-types';

/**
 * Surface only records which the existing private-payment fiscal request flow
 * can accept. The billing RPC remains the authority on permissions, versions
 * and duplicate requests. Merely opening the picker never writes anything.
 */
export function canStartInvoiceRequest(row:BillingRow,data:BillingData):boolean{
 const record=row.record;
 if(!record || !row.patient_id || row.status_atendimento==='cancelled')return false;
 if(record.billing_method!=='PARTICULAR'||record.settlement_mode!=='DIRECT')return false;
 if(record.payment_status!=='PAGO'||!record.billing_entity_id||!record.paid_at)return false;
 if(record.received_amount===null||!Number.isFinite(Number(record.received_amount))||Number(record.received_amount)<0)return false;
 if(record.no_invoice || record.invoice_number || row.invoice)return false;
 if((data.requests||[]).some(request=>request.status!=='CANCELLED'&&
    (request.billing_record_id===record.id||request.attendance_id===row.attendance_id)))return false;
 if(data.items.some(item=>item.billing_record_id===record.id))return false;
 return true;
}

export function availableInvoiceRequestRows(data:BillingData):BillingRow[]{
 const seen=new Set<string>();
 return data.rows.filter(row=>{
  const id=row.record?.id;
  if(!id||seen.has(id)||!canStartInvoiceRequest(row,data))return false;
  seen.add(id);
  return true;
 }).sort((a,b)=>b.date.localeCompare(a.date)||a.patient.localeCompare(b.patient,'pt-BR'));
}
