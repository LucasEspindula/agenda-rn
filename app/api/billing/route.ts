import { getSession } from '@/app/authz';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { secureMutation, readJson, HttpError } from '@/lib/security/http';
import { canReadAppointment, type Row } from '@/lib/security/state';
import {payerKey} from '@/lib/billing-eligibility';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
 const session=await getSession();
 if(!session || session.account.role==='doctor') return Response.json({error:'Acesso negado.'},{status:403});
 const params=new URL(request.url).searchParams,appointmentId=params.get('appointment_id'),summary=params.get('summary')==='1';
 if(session.account.role!=='general_manager'&&!appointmentId&&!summary) return Response.json({error:'Área administrativa restrita à gerência.'},{status:403});
 try {
  const db=getSupabaseAdmin();
  const results=await Promise.all([db.from('app_state').select('payload').eq('id',1).maybeSingle(),db.from('billing_entities').select('*').order('name'),db.from('billing_doctor_entities').select('*'),db.from('billing_records').select('*'),db.from('invoices').select('*'),db.from('invoice_billing_records').select('*'),db.from('doctors').select('id,name,crm,specialty,category,active')]);
  if(results.some(r=>r.error)) throw new Error('query');
  const state=results[0].data?.payload || {};
  const entities:Row[]=results[1].data||[],links:Row[]=results[2].data||[],records:Row[]=results[3].data||[],invoices:Row[]=results[4].data||[],items:Row[]=results[5].data||[];
  const appointments:Row[]=(state.appointments||[]).filter((a:Row)=>canReadAppointment(session,a)&&(!appointmentId||a.id===appointmentId));
  if(appointmentId&&!appointments.length) return Response.json({error:'Atendimento sem acesso ou cancelado.'},{status:404});
  const rows=appointments.map(a=>{
   const patient=(state.patients||[]).find((p:Row)=>p.id===a.patientId),record=records.find(r=>r.appointment_id===a.id)||null;
   const item=record&&items.find(i=>i.billing_record_id===record.id),invoice=item?invoices.find(i=>i.id===item.invoice_id):null;
   return {appointment_id:a.id,date:a.date,time:a.time,patient:patient?.name||'Sem paciente',doctor_id:a.doctorId||a.anesthetistId,anesthetist_id:a.anesthetistId,procedure:a.procedure,insurance:a.insurance||patient?.insurance||'',status_atendimento:a.status,forma_cobranca:a.forma_cobranca||a.billing_method||a.billingMethod||record?.billing_method||null,record,invoice_item:item?{received_amount:item.received_amount??null}:null,invoice:invoice||null,legacy_payment:a.payment||null,legacy_invoice:a.invoiceNumber||null};
  });
  if(summary) return Response.json({rows:rows.map(r=>({appointment_id:r.appointment_id,invoice_number:r.invoice?.invoice_number||r.record?.invoice_number||null}))},{headers:{'Cache-Control':'private, no-store'}});
  if(session.account.role!=='general_manager') for(const row of rows) if(row.invoice) row.invoice={id:row.invoice.id,invoice_number:row.invoice.invoice_number,issue_date:row.invoice.issue_date,paid_at:row.invoice.paid_at};
  const ids=new Set(appointments.flatMap(a=>[a.doctorId,a.anesthetistId]));
  const visibleLinks=session.account.role==='general_manager'?links:links.filter(l=>ids.has(l.doctor_id));
  const entityIds=new Set([...visibleLinks.map(l=>l.billing_entity_id),...rows.map(r=>r.record?.billing_entity_id)]);
  const payers=[...new Set([...rows.map(r=>r.insurance),...(session.account.role==='general_manager'?(state.patients||[]).map((p:Row)=>p.insurance||''):[]),...(session.account.role==='general_manager'?invoices.map(i=>i.payer||''):[])].map(payerKey).filter(Boolean))].sort();
  return Response.json({rows,payers,entities:session.account.role==='general_manager'?entities:entities.filter(e=>entityIds.has(e.id)),links:visibleLinks,doctors:(results[6].data||[]).filter((d:Row)=>session.account.role==='general_manager'||ids.has(d.id)),invoices:session.account.role==='general_manager'?invoices:[],items:session.account.role==='general_manager'?items:[]},{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'Não foi possível carregar o faturamento.'},{status:503});}
}
export const POST=secureMutation(async request=>{
 const session=await getSession();
 if(!session||session.account.role==='doctor') throw new HttpError(403,'Acesso negado.');
 const {kind,data}=await readJson(request);
 if(!['entity','link','record','invoice','delete_entity','delete_link'].includes(kind)||!data||typeof data!=='object'||Array.isArray(data)) throw new HttpError(400,'Operação inválida.');
 if(session.account.role!=='general_manager'&&kind!=='record') throw new HttpError(403,'Somente a gerência pode gerenciar empresas e notas.');
 const {data:id,error}=await getSupabaseAdmin().rpc('save_billing',{p_actor:session.account.id,p_kind:kind,p_data:data});
 if(error){if(error.code==='P0001')throw new HttpError(409,error.message);if(['23505','23514','23502','22P02','22007','22008'].includes(error.code))throw new HttpError(400,'Confira os campos: valor, data, documento ou número de NF inválido/duplicado.');throw new HttpError(503,'Não foi possível salvar o financeiro.');}
 return Response.json({id});
});
