import {getSession,isManager} from '@/app/authz';
import {canUseAgenda} from '@/lib/doctor-services';
import {dbError,getSupabaseAdmin} from '@/lib/supabase-admin';

export const dynamic='force-dynamic';
const PAGE_SIZE=25;
type AgendaAuditRow={id:string;actor_name:string|null;actor_role:string|null;action:string;professional_id:string|null;appointment_id:string|null;patient_id:string|null;created_at:string;metadata:Record<string,unknown>|null};

export async function GET(request:Request){
 const session=await getSession();
 if(!session?.account||!canUseAgenda(session)||!['general_manager','secretary'].includes(session.account.role))return Response.json({error:'Acesso restrito aos logs de agendamento.'},{status:403});
 if(!isManager(session.account.role)&&!session.agendaIds.length)return Response.json({logs:[],next:null},{headers:{'Cache-Control':'private, no-store'}});
 const params=new URL(request.url).searchParams,cursor=params.get('cursor');
 if(cursor&&(cursor.length>64||Number.isNaN(Date.parse(cursor))))return Response.json({error:'Cursor inválido.'},{status:400});
 const db=getSupabaseAdmin();
 let query=db.from('audit_logs').select('id,actor_name,actor_role,action,professional_id,appointment_id,patient_id,created_at,metadata').eq('organization_id',session.organization.id);
 if(!isManager(session.account.role))query=query.in('professional_id',session.agendaIds);
 if(cursor)query=query.lt('created_at',cursor);
 const result=await query.order('created_at',{ascending:false}).limit(PAGE_SIZE+1);
 dbError(result.error,'Read agenda logs');
 const rows=(result.data||[]).filter((row:AgendaAuditRow)=>isManager(session.account.role)||session.agendaIds.includes(String(row.professional_id))).slice(0,PAGE_SIZE),hasMore=(result.data||[]).length>PAGE_SIZE;
 const requestIds=[...new Set(rows.map((row:AgendaAuditRow)=>{
  const metadata=row.metadata as Record<string,unknown>|null;
  return typeof metadata?.requestId==='string'?metadata.requestId:null;
 }).filter((id:string|null):id is string=>!!id))];
 const requestPayloads=new Map<string,{before:unknown;after:unknown;action:string}>();
 if(requestIds.length){
  let linkedQuery=db.from('agenda_requests').select('id,professional_id,action,previous_payload,proposed_payload').eq('organization_id',session.organization.id).in('id',requestIds);
  if(!isManager(session.account.role))linkedQuery=linkedQuery.in('professional_id',session.agendaIds);
  const linked=await linkedQuery;
  dbError(linked.error,'Read audit request snapshots');
  for(const row of linked.data||[])requestPayloads.set(String(row.id),{before:row.previous_payload||null,after:row.proposed_payload||null,action:String(row.action||'')});
 }
 const logs=rows.map((row:AgendaAuditRow)=>{
  const metadata=(row.metadata||{}) as Record<string,unknown>;
  const linked=typeof metadata.requestId==='string'?requestPayloads.get(metadata.requestId):null;
  return {...row,actorName:row.actor_name,actorRole:row.actor_role,professionalId:row.professional_id,appointmentId:row.appointment_id,patientId:row.patient_id,createdAt:row.created_at,requestAction:linked?.action??metadata.requestAction??null,before:linked?.before??metadata.before??null,after:linked?.after??metadata.after??null};
 });
 return Response.json({logs,next:hasMore?rows[rows.length-1].created_at:null},{headers:{'Cache-Control':'private, no-store'}});
}
