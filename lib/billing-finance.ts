import type {BillingData,BillingRow} from './billing-types';
export const directPayment=(row:BillingRow,data:BillingData,method:string)=>(!row.invoice||row.invoice.recipient_type==='PARTICULAR')&&(row.record?.settlement_mode==='DIRECT'||method==='PARTICULAR'||data.doctors.find(d=>d.id===row.doctor_id)?.invoice_enabled===false);
export const allowedEntities=(row:BillingRow,data:BillingData,professionalId?:string)=>data.entities.filter(e=>e.id===row.record?.billing_entity_id||(e.active&&data.links.some(l=>l.active&&l.billing_entity_id===e.id&&(professionalId?l.doctor_id===professionalId:[row.doctor_id,row.anesthetist_id].includes(l.doctor_id)))));


