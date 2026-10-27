import type {BillingData,BillingRow} from './billing-types';

// The persisted invoice state uses ACTIVE (issued), CANCELLED and REPLACED.
// An invoice request is not an issued invoice.
export const ISSUED_NF_CANCEL_MESSAGE =
  'Não é possível cancelar ou excluir este atendimento, pois existe uma Nota Fiscal emitida vinculada a ele.';

export function invoicesForAttendance(row:Pick<BillingRow,'attendance_id'|'record'|'invoice'>,data:Pick<BillingData,'rows'|'items'|'invoices'>){
 const records=new Set(data.rows.filter(item=>item.attendance_id===row.attendance_id)
   .map(item=>item.record?.id).filter((id):id is string=>!!id));
 if(row.record?.id)records.add(row.record.id);
 const invoiceIds=new Set(data.items.filter(item=>records.has(item.billing_record_id)).map(item=>item.invoice_id));
 if(row.invoice?.id)invoiceIds.add(row.invoice.id);
 return data.invoices.filter(invoice=>invoiceIds.has(invoice.id));
}

export function hasIssuedInvoiceForAttendance(row:BillingRow,data:BillingData){
 const ids=new Set(data.rows.filter(item=>item.attendance_id===row.attendance_id)
   .map(item=>item.record?.id).filter((id):id is string=>!!id));
 if(row.record?.id)ids.add(row.record.id);
 return data.items.some(item=>item.is_active!==false&&ids.has(item.billing_record_id)
   &&data.invoices.some(invoice=>invoice.id===item.invoice_id
     &&invoice.status==='ACTIVE'&&!invoice.voided_at));
}

export function operationalAttendanceStatus(row:BillingRow){
 const statuses:Record<string,string>={scheduled:'Agendado',realized:'Realizado',cancelled:'Cancelado'};
 return statuses[row.status_atendimento]||row.status_atendimento||'Não informado';
}

export function fiscalAttendanceStatus(row:BillingRow,data:BillingData){
 const invoices=invoicesForAttendance(row,data);
 if(invoices.length){
  const names:Record<string,string>={ACTIVE:'Emitida',CANCELLED:'Cancelada',REPLACED:'Substituída'};
  const labels=[...new Set(invoices.map(i=>names[i.status||'']||i.status||'Não informado'))];
  // Never choose a single invoice when the attendance has fiscal history
  // with more than one document/status.
  return labels.join(' / ');
 }
 const requests=(data.requests||[]).filter(r=>r.attendance_id===row.attendance_id);
 if(requests.some(r=>r.status==='ISSUED'))return 'Solicitação emitida';
 if(requests.some(r=>r.status==='PENDING'))return 'Solicitada';
 if(requests.some(r=>r.status==='CANCELLED'))return 'Solicitação cancelada';
 return 'Sem NF';
}
