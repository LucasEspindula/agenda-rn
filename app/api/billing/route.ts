import {getSession} from '@/app/authz';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {secureMutation,readJson,HttpError} from '@/lib/security/http';
import {canReadAppointment,type Row} from '@/lib/security/state';
import {loadBillingData} from '@/lib/billing-data';
import {doctorBillingProjection,projectFinancialRow} from '@/lib/billing-projection';
import {canOpenBilling,canOpenInvoices} from '@/lib/doctor-services';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const session=await getSession();if(!session)return Response.json({error:'Acesso negado.'},{status:403});
 const params=new URL(request.url).searchParams,appointmentId=params.get('appointment_id'),summary=params.get('summary')==='1';
 if(session.account.role==='doctor'&&!(params.get('view')==='invoices'?canOpenInvoices(session):canOpenBilling(session)))return Response.json({error:'Use a consulta financeira no paciente.'},{status:403});
 if(session.account.role==='secretary'&&!appointmentId&&!summary)return Response.json({error:'Área restrita à gerência.'},{status:403});
 try{
  const {data,state}=await loadBillingData();
  if(session.account.role==='doctor')return Response.json(doctorBillingProjection(data,session,params.get('view')==='invoices'),{headers:{'Cache-Control':'private, no-store'}});
  if(session.account.role==='secretary'||appointmentId){
   const allowed=new Set((state.appointments||[]).filter((a:Row)=>canReadAppointment(session,a)&&(!appointmentId||a.id===appointmentId)).map((a:Row)=>a.id));
   if(appointmentId&&!allowed.has(appointmentId))return Response.json({error:'Atendimento sem acesso.'},{status:404});
   const existingChargesForAppointment=!!appointmentId&&data.rows.some(r=>r.appointment_id===appointmentId&&!!r.record);
   data.rows=data.rows.filter(r=>!!r.appointment_id&&allowed.has(r.appointment_id)&&(
    session.account.role!=='secretary'||session.agendaIds.includes(r.doctor_id)
   ));
   const accessibleRecordIds=new Set(data.rows.map(row=>row.record?.id).filter(Boolean));
   data.requests=(data.requests||[]).filter(r=>accessibleRecordIds.has(r.billing_record_id));
   // A scoped read may project an authorized scheduled appointment without writing finance.
   if(appointmentId&&!data.rows.length&&!existingChargesForAppointment){
    const a=(state.appointments||[]).find((a:Row)=>a.id===appointmentId);
    const p=(state.patients||[]).find((p:Row)=>p.id===a.patientId);
    data.rows=[projectFinancialRow({id:a.id,appointment_id:a.id,patient_id:a.patientId||null,origin:'AGENDA',doctor_id:a.doctorId,anesthetist_id:a.anesthetistId,date:a.date,procedure:a.procedure,insurance:a.insurance??p?.insurance??'',status:a.status,billing_method:a.forma_cobranca||null},null,null,null,p?.name||'Paciente não informado')];
   }
  }
  if(summary)return Response.json({rows:data.rows.map(r=>({appointment_id:r.appointment_id,invoice_number:r.invoice?.invoice_number||r.record?.invoice_number||null}))},{headers:{'Cache-Control':'private, no-store'}});
  if(session.account.role==='secretary'){
   const entityIds=new Set(data.rows.map(r=>r.record?.billing_entity_id));const doctors=new Set(data.rows.map(r=>r.doctor_id));
   data.links=data.links.filter(l=>doctors.has(l.doctor_id));data.links.forEach(l=>entityIds.add(l.billing_entity_id));
   data.entities=data.entities.filter(e=>entityIds.has(e.id));data.doctors=data.doctors.filter(d=>doctors.has(d.id));
   data.rows=data.rows.map(r=>({...r,invoice:r.invoice?{...r.invoice,total_amount:null,net_amount:null,notes:null,recipient_tax_id:null,recipient_address:null}:null}));
   data.requests=(data.requests||[]).map(r=>({...r,taker_tax_id:'',taker_address:null,notes:null}));
   data.payment_parts=(data.payment_parts||[]).filter(p=>!!p.billing_record_id&&data.rows.some(r=>r.record?.id===p.billing_record_id));data.attachments=(data.attachments||[]).filter(a=>!!a.billing_record_id&&data.rows.some(r=>r.record?.id===a.billing_record_id));data.invoices=[];data.items=[];data.expenses=[];data.associates=[];data.patients=(data.patients||[]).filter(p=>data.rows.some(r=>r.patient_id===p.id));data.users=[];data.payers=[...new Set(data.rows.map(r=>r.insurance))];
  }
  return Response.json(data,{headers:{'Cache-Control':'private, no-store'}});
 }catch{return Response.json({error:'Não foi possível carregar o faturamento.'},{status:503});}
}
export const POST=secureMutation(async request=>{
 const session=await getSession();
 if(!session||session.account.role==='doctor') throw new HttpError(403,'Acesso negado.');
 const {kind,data}=await readJson(request);
 if(!['entity','link','record','professional_charge','professional_invoice','invoice','delete_entity','delete_link','attendance','expense','undo_invoice','cancel_invoice','replace_invoice','cancel_attendance'].includes(kind)||!data||typeof data!=='object'||Array.isArray(data)) throw new HttpError(400,'Operação inválida.');
 if(session.account.role!=='general_manager'&&!['record','professional_charge'].includes(kind)) throw new HttpError(403,'Somente a gerência pode gerenciar empresas e notas.');
 if(['professional_charge','professional_invoice'].includes(kind)&&process.env.RN_PROFESSIONAL_BILLING_ENABLED!=='true') throw new HttpError(404,'Faturamento por profissional aguarda homologação da migration.');
 const rpc=kind==='cancel_attendance'?'cancel_manual_attendance':kind==='attendance'?'save_manual_attendance':['expense','associate'].includes(kind)?'save_company_finance':kind==='professional_charge'?'save_professional_charge':kind==='professional_invoice'?'save_professional_invoice':'save_billing';
 const args=['attendance','cancel_attendance'].includes(kind)||['professional_charge','professional_invoice'].includes(kind)?{}:{p_kind:kind};
 const {data:id,error}=await getSupabaseAdmin().rpc(rpc,{p_actor:session.account.id,...args,p_data:data});
 if(error){if(error.code==='23503')throw new HttpError(409,'Registro possui histórico ou vínculo obrigatório. Confira os vínculos ou inative o cadastro.');if(error.code==='P0001')throw new HttpError(409,error.message);if(['23505','23514','23502','22P02','22007','22008'].includes(error.code))throw new HttpError(400,'Confira os campos: valor, data, documento ou número de NF inválido/duplicado.');throw new HttpError(503,'Não foi possível salvar o financeiro.');}
 return Response.json({id});
});

