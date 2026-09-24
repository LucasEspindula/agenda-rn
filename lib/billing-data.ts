import 'server-only';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import type {BillingData,Financial,Invoice,BillingRow} from './billing-types';
import {projectFinancialRow} from './billing-projection';
import {payerKey} from './billing-eligibility';
export async function loadBillingData(){
 const db=getSupabaseAdmin();
 // Fetch complete sets: truncating invoice items could wrongly classify a shared NF as private.
 async function allRows(table:string,columns='*'){
  const first=await db.from(table).select(columns).order('id').range(0,999);
  if(first.error)throw new Error('Não foi possível carregar o faturamento.');
  const data=first.data||[];
  for(let offset=1000;data.length===offset;offset+=1000){
   const page=await db.from(table).select(columns).order('id').range(offset,offset+999);
   if(page.error)throw new Error('Não foi possível carregar o faturamento.');
   data.push(...(page.data||[]));
  }
  return {data,error:null};
 }
 const names=['billing_entities','billing_doctor_entities','billing_records','invoices','invoice_billing_records','doctors','attendances','company_expenses','company_associates'] as const;
 const [stateResult,...results]=await Promise.all([db.from('app_state').select('payload').eq('id',1).maybeSingle(),...names.map(t=>allRows(t)),allRows('users','id,name,role')]);
 if(stateResult.error||results.some(r=>r.error))throw new Error('Não foi possível carregar o faturamento.');
 const state=stateResult.data?.payload||{};
 const records=results[2].data as Financial[],invoices=results[3].data as Invoice[],items=results[4].data as BillingData['items'];
 const patients=(state.patients||[]) as {id:string;name:string;insurance?:string;created_at?:string;created_by?:number}[];
 const rows=(results[6].data||[]).map((t:Record<string,unknown>)=>{
  const record=records.find(b=>b.attendance_id===t.id)||null,item=record?items.find(i=>i.billing_record_id===record.id):null;
  const appointment=!record?(state.appointments||[]).find((a:{id:string})=>a.id===t.appointment_id):null;
  return projectFinancialRow({...t,anesthetist_id:appointment?.anesthetistId||''},record,item?invoices.find(i=>i.id===item.invoice_id)||null:null,item?{received_amount:item.received_amount??null}:null,patients.find(p=>p.id===t.patient_id)?.name||'Paciente não informado');
 }) as BillingRow[];
 const data:BillingData={rows,entities:results[0].data,links:results[1].data,doctors:results[5].data,invoices,items,expenses:results[7].data,associates:results[8].data,users:results[9].data,patients:patients.map(p=>({id:p.id,name:p.name,created_by:p.created_by,created_at:p.created_at})),payers:[...new Set([...patients.map(p=>p.insurance||''),...rows.map(r=>r.insurance),...invoices.map(i=>i.payer)].map(payerKey).filter(Boolean))].sort()};
 return {data,state};
}

