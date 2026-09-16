import type {BillingData,BillingRow} from './billing-types';
export const payerKey=(value:string)=>value.trim().replace(/\s+/g,' ').toUpperCase();
export function eligibleForInvoice(row:BillingRow,data:Pick<BillingData,'links'>,entity:string,payer:string,invoiceId?:string){
 if(!entity||!payer||row.status_atendimento!=='realized'||row.forma_cobranca!=='CONVENIO')return false;
 if(payerKey(row.insurance)!==payerKey(payer))return false;
 if(!data.links.some(l=>l.active&&l.billing_entity_id===entity&&[row.doctor_id,row.anesthetist_id].includes(l.doctor_id)))return false;
 if(row.invoice&&row.invoice.id!==invoiceId)return false;
 if(row.record&&!row.invoice&&(row.record.payment_status==='PAGO'||row.record.billing_method!=='CONVENIO'))return false;
 return true;
}
