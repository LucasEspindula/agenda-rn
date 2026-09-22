import type {BillingData,BillingRow,Expense} from './billing-types';
export const rowEntityId=(row:BillingRow)=>row.record?.billing_entity_id||row.billing_entity_id||'';
export const companyLabel=(data:BillingData,id:string)=>{const e=data.entities.find(e=>e.id===id);return e?.trade_name||e?.name||'—'};
export function isInsurancePending(row:BillingRow){return row.status_atendimento==='realized'&&row.forma_cobranca==='CONVENIO'&&!(row.invoice?row.invoice.paid_at:row.record?.payment_status==='PAGO');}
export type RowFilters={entity:string;doctor:string;insurance?:string;start:string;end:string};
export function matchesRow(row:BillingRow,f:RowFilters){return (!f.entity||rowEntityId(row)===f.entity)&&(!f.doctor||[row.doctor_id,row.anesthetist_id].includes(f.doctor))&&(!f.insurance||row.insurance.trim().toUpperCase()===f.insurance.trim().toUpperCase())&&(!f.start||row.date>=f.start)&&(!f.end||row.date<=f.end);}
export function expensePayer(data:BillingData,e:Expense){const link=data.links.find(l=>l.id===e.paid_by_doctor_entity_link_id);return data.doctors.find(d=>d.id===link?.doctor_id)?.name||data.associates?.find(a=>a.id===e.paid_by_associate_id)?.name||'—';}
