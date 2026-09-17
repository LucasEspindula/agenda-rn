import {getSession} from '@/app/authz';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {HttpError,readJson,secureMutation} from '@/lib/security/http';
import {hashPassword} from '@/app/passwords';
import {z} from 'zod';
export const dynamic='force-dynamic';
export async function GET(){
 const session=await getSession();if(!session||session.account.role!=='general_manager')return Response.json({error:'Acesso restrito à gerência.'},{status:403});
 const db=getSupabaseAdmin();const [doctors,agendas,accounts]=await Promise.all([db.from('doctors').select('*').order('name'),db.from('doctor_agendas').select('*'),db.from('users').select('id,email,doctor_id,updated_at').eq('role','doctor')]);
 if(doctors.error||agendas.error||accounts.error)return Response.json({error:'Não foi possível carregar os médicos.'},{status:503});
 return Response.json({doctors:doctors.data,agendas:agendas.data,accounts:accounts.data},{headers:{'Cache-Control':'private, no-store'}});
}
export const POST=secureMutation(async request=>{
 const session=await getSession();if(!session||session.account.role!=='general_manager')throw new HttpError(403,'Acesso restrito à gerência.');
 const {kind,data,access}=await readJson(request);if(!['doctor','agenda'].includes(kind)||!data||typeof data!=='object'||Array.isArray(data))throw new HttpError(400,'Operação inválida.');
 let account=null,credentials=null;
 if(access!=null){
  const parsed=z.object({id:z.number().positive().optional(),email:z.string().trim().email().max(254),password:z.string().min(12).max(128).optional(),updated_at:z.string().optional()}).strict().safeParse(access);
  if(!parsed.success||kind!=='doctor')throw new HttpError(400,'Confira e-mail e senha (12 a 128 caracteres).');
  const {password,...metadata}=parsed.data;account=metadata;credentials=password?await hashPassword(password):null;
 }
 const result=await getSupabaseAdmin().rpc('save_doctor_with_access',{p_actor:session.account.id,p_kind:kind,p_data:data,p_access:account,p_credentials:credentials});
 if(result.error)throw new HttpError(result.error.code==='P0001'?409:400,result.error.code==='P0001'?result.error.message:'Confira os dados do cadastro.');
 return Response.json({id:result.data});
});
