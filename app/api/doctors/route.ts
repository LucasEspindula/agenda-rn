import {getSession} from '@/app/authz';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {HttpError,readJson,secureMutation} from '@/lib/security/http';
import {hashPassword} from '@/app/passwords';
import {canonicalSpecialty} from '@/lib/medical-specialties';
import {z} from 'zod';
export const dynamic='force-dynamic';
type DoctorAccount={id:number;email:string;doctor_id:string|null;updated_at:string;active:boolean};
type AgendaGrant={user_id:number;professional_id:string};
export async function GET(){
 const session=await getSession();if(!session||session.account.role!=='general_manager')return Response.json({error:'Acesso restrito à gerência.'},{status:403});
 // Somente médicos, agendas, contas e acessos da organização do gerente autenticado.
 const db=getSupabaseAdmin(),org=session.organization.id;
 const members=await db.from('organization_memberships').select('user_id').eq('organization_id',org);
 if(members.error)return Response.json({error:'Não foi possível carregar os médicos.'},{status:503});
 const memberIds=(members.data||[]).map((m:{user_id:number})=>m.user_id);
 const [doctors,agendas,accounts,grants]=await Promise.all([db.from('doctors').select('*').eq('organization_id',org).order('name'),db.from('doctor_agendas').select('*').eq('organization_id',org),memberIds.length?db.from('users').select('id,email,doctor_id,active,updated_at').eq('role','doctor').in('id',memberIds):Promise.resolve({data:[],error:null}),db.from('agenda_access').select('user_id,professional_id').eq('organization_id',org)]);
 if(doctors.error||agendas.error||accounts.error||grants.error)return Response.json({error:'Não foi possível carregar os médicos.'},{status:503});
 return Response.json({doctors:doctors.data,agendas:agendas.data,accounts:((accounts.data||[]) as DoctorAccount[]).map(a=>({...a,agendaIds:((grants.data||[]) as AgendaGrant[]).filter(g=>g.user_id===a.id).map(g=>g.professional_id)}))},{headers:{'Cache-Control':'private, no-store'}});
}
export const POST=secureMutation(async request=>{
 const session=await getSession();if(!session||session.account.role!=='general_manager')throw new HttpError(403,'Acesso restrito à gerência.');
 const {kind,data,access}=await readJson(request);if(!['doctor','agenda'].includes(kind)||!data||typeof data!=='object'||Array.isArray(data))throw new HttpError(400,'Operação inválida.');
 if(kind==='doctor'){const specialty=canonicalSpecialty(String(data.specialty||''));if(!specialty)throw new HttpError(400,'Selecione uma especialidade da lista.');data.specialty=specialty;delete data.category;}
 let account=null,credentials=null;
 if(access!=null){
  const parsed=z.object({id:z.number().positive().optional(),email:z.string().trim().email().max(254),password:z.string().min(12).max(128).optional(),active:z.boolean().optional(),updated_at:z.string().optional(),agendaIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(500).optional()}).strict().safeParse(access);
  if(!parsed.success||kind!=='doctor')throw new HttpError(400,'Confira e-mail e senha (12 a 128 caracteres).');
  const {password,...metadata}=parsed.data;account=metadata;credentials=password?await hashPassword(password):null;
 }
 const result=await getSupabaseAdmin().rpc('save_doctor_with_access',{p_actor:session.account.id,p_kind:kind,p_data:data,p_access:account,p_credentials:credentials,p_org:session.organization.id});
 if(result.error)throw new HttpError(result.error.code==='P0001'?409:400,result.error.code==='P0001'?result.error.message:'Confira os dados do cadastro.');
 return Response.json({id:result.data});
});
