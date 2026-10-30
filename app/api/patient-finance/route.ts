import {getSession} from '@/app/authz';
import {loadBillingData} from '@/lib/billing-data';
import {individualReceived} from '@/lib/billing-reports';
export const dynamic='force-dynamic';
export async function GET(request:Request){
 const s=await getSession();
 if(!s||s.account.role!=='doctor'||!s.account.doctorId||!s.services?.scheduling_enabled||!s.services?.billing_enabled)return Response.json({error:'Acesso negado.'},{status:403});
 const patientId=new URL(request.url).searchParams.get('patient_id');if(!patientId)return Response.json({error:'Paciente obrigatório.'},{status:400});
 try{const {data}=await loadBillingData(s.account.id);const rows=data.rows.filter(r=>r.doctor_id===s.account.doctorId&&r.patient_id===patientId).map(r=>({id:r.attendance_id,date:r.date,procedure:r.procedure,insurance:r.insurance,status_atendimento:r.status_atendimento,billing_method:r.forma_cobranca,invoice_number:r.invoice?.invoice_number||r.record?.invoice_number||null,received_amount:individualReceived(r),paid_at:r.invoice?.paid_at||r.record?.paid_at||null,payment_status:r.invoice&&r.invoice.recipient_type!=='PARTICULAR'?(r.invoice.paid_at?'PAGO':'PENDENTE'):r.record?.payment_status||'PENDENTE'}));return Response.json({rows},{headers:{'Cache-Control':'private, no-store'}});}catch{return Response.json({error:'Não foi possível consultar o financeiro.'},{status:503});}
}
