import 'server-only';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {financialActorOrganizationId} from '@/lib/financial-organization';
import type {BillingData,Financial,Invoice,BillingRow} from './billing-types';
import {projectFinancialRow} from './billing-projection';
import {payerKey} from './billing-eligibility';
import {includeArchivedCancellations} from './billing-cancelled';
import {formatPatientAddress,type PatientAddressInput} from './patient-address';
export async function loadBillingData(actorId:number){
 // Never fetch financial data without validating the actor's active organization on the server.
 const organizationId=await financialActorOrganizationId(actorId);
 if(!organizationId)throw new Error('Acesso à organização negado.');
 const db=getSupabaseAdmin();
 // Fetch complete sets: truncating invoice items could wrongly classify a shared NF as private.
 async function allRows(table:string,columns='*'){
  const scopeColumn=table==='users'?'organization_memberships.organization_id':'organization_id';
  const first=await db.from(table).select(columns).eq(scopeColumn,organizationId).order('id').range(0,999);
  if(first.error)throw new Error('Não foi possível carregar o faturamento.');
  const data=first.data||[];
  for(let offset=1000;data.length===offset;offset+=1000){
   const page=await db.from(table).select(columns).eq(scopeColumn,organizationId).order('id').range(offset,offset+999);
   if(page.error)throw new Error('Não foi possível carregar o faturamento.');
   data.push(...(page.data||[]));
  }
  return {data,error:null};
 }
 const names=['billing_entities','billing_doctor_entities','billing_records','invoices','invoice_billing_records','doctors','attendances','company_expenses','company_associates','invoice_requests'] as const;
 const attachmentColumns='id,document_type,invoice_id,billing_record_id,original_filename,mime_type,file_size,status,is_current,replaces_attachment_id,replaced_by_attachment_id,deactivated_at,deactivation_reason,created_at,created_by,updated_at,updated_by';
 const [stateResult,...results]=await Promise.all([db.from('app_state').select('payload,organizations!inner(slug,active)').eq('organization_id',organizationId).eq("organizations.slug","rn-gestao").eq("organizations.active",true).maybeSingle(),...names.map(t=>allRows(t)),allRows('users','id,name,role,organization_memberships!inner(organization_id)'),allRows('payment_parts'),allRows('financial_attachments',attachmentColumns)]);
 if(stateResult.error||!stateResult.data||results.some(r=>r.error))throw new Error('Não foi possível carregar o faturamento.');
 const state=stateResult.data?.payload||{};
 const records=results[2].data as Financial[],invoices=results[3].data as Invoice[],items=results[4].data as BillingData['items'];
 const patients=(state.patients||[]) as ({id:string;name:string;insurance?:string;cpf?:string;phone?:string;email?:string;cardNumber?:string;created_at?:string;created_by?:number}&PatientAddressInput)[];
 const itemsByRecord=new Map(items.filter(item=>item.is_active!==false).map(item=>[item.billing_record_id,item]));
 const recordsByAttendance=new Map<string,Financial[]>();
 for(const record of records){const current=recordsByAttendance.get(record.attendance_id)||[];current.push(record);recordsByAttendance.set(record.attendance_id,current);}
 const rows=(results[6].data||[]).flatMap((t:Record<string,unknown>)=>{
  const attendanceRecords=recordsByAttendance.get(String(t.id))||[null];
  // Anesthesia ownership belongs to the legacy appointment state, not to billing_records.
  // Always enrich it from the appointment so financial authorization sees the same agenda.
  const appointment=(state.appointments||[]).find((a:{id:string})=>a.id===t.appointment_id);
  return attendanceRecords.map(record=>{const item=record?itemsByRecord.get(record.id):null;return projectFinancialRow({...t,anesthetist_id:appointment?.anesthetistId||''},record,item?invoices.find(i=>i.id===item.invoice_id)||null:null,item?{received_amount:item.received_amount??null}:null,patients.find(p=>p.id===t.patient_id)?.name||'Paciente não informado');});
 }) as BillingRow[];
 const projectedRows=includeArchivedCancellations(rows,state.cancelledAppointments||[],results[1].data,patients);
 const data:BillingData={rows:projectedRows,entities:results[0].data,links:results[1].data,doctors:results[5].data,invoices,items,expenses:results[7].data,associates:results[8].data,requests:results[9].data,users:(results[10].data||[]).map((user:Record<string,unknown>)=>({id:Number(user.id),name:String(user.name||''),role:typeof user.role==='string'?user.role:undefined})),payment_parts:results[11].data,attachments:results[12].data,patients:patients.map(p=>({id:p.id,name:p.name,cpf:p.cpf,address:formatPatientAddress(p),phone:p.phone,email:p.email,insurance:p.insurance,cardNumber:p.cardNumber,created_by:p.created_by,created_at:p.created_at})),payers:[...new Set([...patients.map(p=>p.insurance||''),...projectedRows.map(r=>r.insurance),...invoices.filter(i=>i.recipient_type!=='PARTICULAR').map(i=>i.payer)].map(payerKey).filter(Boolean))].sort()};
 return {data,state};
}

