import type {BillingData,BillingRow} from './billing-types';
import {payerKey} from './billing-eligibility';
type RecordData=Record<string,unknown>;
export type FinancialPrincipal={account:{id:number;role:string;doctorId?:string|null};agendaIds:string[];services?:{scheduling_enabled:boolean;billing_enabled:boolean;invoice_enabled:boolean}};
export function doctorBillingProjection(data:BillingData,principal:FinancialPrincipal,invoiceOnly=false):BillingData{
 const id=principal.account.doctorId;
 const rows=data.rows.filter(r=>!!id&&r.doctor_id===id&&((!invoiceOnly&&principal.services?.billing_enabled)||data.items.some(item=>item.billing_record_id===r.record?.id)));
 const recordIds=new Set(rows.map(r=>r.record?.id));
 const visibleItems=data.items.filter(i=>recordIds.has(i.billing_record_id));
 const invoiceIds=new Set(visibleItems.map(i=>i.invoice_id));
 const invoices=data.invoices.filter(i=>invoiceIds.has(i.id)).map(i=>{
  const shared=data.items.some(item=>item.invoice_id===i.id&&!recordIds.has(item.billing_record_id));
  return {...i,recipient_tax_id:null,recipient_address:null,notes:null,total_amount:shared?null:i.total_amount,net_amount:shared?null:i.net_amount,shared,created_by:null,updated_by:null};
 });
 const entities=new Set([...rows.map(r=>r.record?.billing_entity_id),...invoices.map(i=>i.billing_entity_id)]);
 return {rows:rows.map(r=>({...r,invoice:r.invoice?invoices.find(i=>i.id===r.invoice?.id)||null:null,record:r.record?{...r.record,notes:null,created_by:null,updated_by:null}:null,created_by:null,updated_by:null})),doctors:data.doctors.filter(d=>d.id===id),entities:data.entities.filter(e=>entities.has(e.id)),links:[],invoices,items:visibleItems,payers:[...new Set(rows.map(r=>payerKey(r.insurance)).filter(Boolean))],expenses:[],associates:[],patients:[],users:[],read_only:true,doctor_id:id||undefined,services:principal.services};
}
export function projectFinancialRow(t:RecordData,record:BillingRow['record'],invoice:BillingRow['invoice'],item:BillingRow['invoice_item'],patient:string):BillingRow{
 return {...t,attendance_id:String(t.id),appointment_id:t.appointment_id as string|null,patient_id:t.patient_id as string|null,origin:String(t.origin),date:String(t.date),time:'',patient,doctor_id:String(t.doctor_id),anesthetist_id:String(t.anesthetist_id||''),procedure:String(t.procedure),insurance:String(t.insurance||''),status_atendimento:String(t.status),forma_cobranca:t.billing_method as string|null,record,invoice,invoice_item:item,legacy_payment:null,legacy_invoice:null} as BillingRow;
}
