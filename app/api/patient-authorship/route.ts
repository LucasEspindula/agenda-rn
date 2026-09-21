import {getSession} from '@/app/authz';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {visibleState,type Row} from '@/lib/security/state';
import {canUseAgenda} from '@/lib/doctor-services';
export async function GET(request:Request){
 const s=await getSession();if(!s||!canUseAgenda(s))return Response.json({error:'Acesso negado.'},{status:403});
 const id=new URL(request.url).searchParams.get('patient_id'),db=getSupabaseAdmin();
 const result=await db.from('app_state').select('payload').eq('id',1).maybeSingle();if(result.error)return Response.json({error:'Consulta indisponível.'},{status:503});
 const patient=visibleState(result.data?.payload||{},s).patients?.find((p:Row)=>p.id===id);if(!patient)return Response.json({error:'Paciente não disponível.'},{status:404});
 const ids=[patient.created_by,patient.updated_by].filter(v=>v!=null);const users=ids.length?await db.from('users').select('id,name').in('id',ids):{data:[],error:null};if(users.error)return Response.json({error:'Consulta indisponível.'},{status:503});
 const name=(id:number)=>users.data?.find((u:Row)=>u.id===id)?.name||null;
 return Response.json({created_at:patient.created_at||null,created_by_name:name(patient.created_by),updated_at:patient.updated_at||null,updated_by_name:name(patient.updated_by)},{headers:{'Cache-Control':'private, no-store'}});
}
