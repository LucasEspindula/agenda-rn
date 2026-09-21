import {getSession} from '@/app/authz';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {secureMutation,readJson,HttpError} from '@/lib/security/http';
import {canReadAppointment,type Row} from '@/lib/security/state';
import {loadBillingData} from '@/lib/billing-data';
import {doctorBillingProjection} from '@/lib/billing-projection';
import {canOpenBilling} from '@/lib/doctor-services';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const session=await getSession();if(!session)return Response.json({error:'Acesso negado.'},{status:403});
 const params=new URL(request.url).searchParams,appointmentId=params.get('appointment_id'),summary=params.get('summary')==='1';
 if(session.account.role==='doctor'&&!canOpenBilling(session))return Response.json({error:'Use a consulta financeira no paciente.'},{status:403});
 if(session.account.role==='secretary'&&!appointmentId&&!summary)return Response.json({error:'Área restrita à gerência.'},{status:403});
 try{
  const {data,state}=await loadBillingData();
  if(session.account.role==='doctor')return Response.json(doctorBillingProjection(data,session),{headers:{'Cache-Control':'private, no-store'}});
  if(session.account.role==='secretary'||appointmentId){
   const allowed=new Set((state.appointments||[]).filter((a:Row)=>canReadAppointment(session,a)&&(!appointmentId||a.id===appointmentId)).map((a:Row)=>a.id));
   if(appointmentId&&!allowed.has(appointmentId))return Response.json({error:'Atendimento sem acesso.'},{status:404});
   data.rows=data.rows.filter(r=>!!r.appointment_id&&allowed.has(r.appointment_id));
  }
  if(summary)return Response.json({rows:data.rows.map(r=>({appointment_id:r.appointment_id,invoice_number:r.invoice?.invoice_number||r.record?.invoice_number||null}))},{headers:{'Cache-Control':'private, no-store'}});
  if(session.account.role==='secretary'){
   const entityIds=new Set(data.rows.map(r=>r.record?.billing_entity_id));const doctors=new Set(data.rows.map(r=>r.doctor_id));
   data.links=data.links.filter(l=>doctors.has(l.doctor_id));data.links.forEach(l=>entityIds.add(l.billing_entity_id));
   data.entities=data.entities.filter(e=>entityIds.has(e.id));data.doctors=data.doctors.filter(d=>doctors.has(d.id));
   data.rows=data.rows.map(r=>({...r,invoice:r.invoice?{...r.invoice,total_amount:null,net_amount:null,notes:null}:null}));
   data.invoices=[];data.items=[];data.expenses=[];data.associates=[];data.patients=[];data.users=[];data.payers=[...new Set(data.rows.map(r=>r.insurance))];
  }
  return Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'Não foi possível carregar o faturamento.'},{status:503});}
}
export const POST=secureMutation(async request=>{
 const session=await getSession();
 if(!session||session.account.role==='doctor') throw new HttpError(403,'Acesso negado.');
 const {kind,data}=await readJson(request);
 if(!['entity','link','record','invoice','delete_entity','delete_link','attendance','expense','associate'].includes(kind)||!data||typeof data!=='object'||Array.isArray(data)) throw new HttpError(400,'Operação inválida.');
 if(session.account.role!=='general_manager'&&kind!=='record') throw new HttpError(403,'Somente a gerência pode gerenciar empresas e notas.');
 const {data:id,error}=await getSupabaseAdmin().rpc(kind==='attendance'?'save_manual_attendance':['expense','associate'].includes(kind)?'save_company_finance':'save_billing',{p_actor:session.account.id,...(kind==='attendance'?{}:{p_kind:kind}),p_data:data});
 if(error){if(error.code==='23503')throw new HttpError(409,'Registro possui histórico ou vínculo obrigatório. Confira os vínculos ou inative o cadastro.');if(error.code==='P0001')throw new HttpError(409,error.message);if(['23505','23514','23502','22P02','22007','22008'].includes(error.code))throw new HttpError(400,'Confira os campos: valor, data, documento ou número de NF inválido/duplicado.');throw new HttpError(503,'Não foi possível salvar o financeiro.');}
 return Response.json({id});
});
