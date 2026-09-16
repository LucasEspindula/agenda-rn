import {getSession} from '@/app/authz';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {HttpError,readJson,secureMutation} from '@/lib/security/http';
export const dynamic='force-dynamic';
export async function GET(){
 const session=await getSession();if(!session||session.account.role!=='general_manager')return Response.json({error:'Acesso restrito à gerência.'},{status:403});
 const db=getSupabaseAdmin();const [doctors,agendas]=await Promise.all([db.from('doctors').select('*').order('name'),db.from('doctor_agendas').select('*')]);
 if(doctors.error||agendas.error)return Response.json({error:'Não foi possível carregar os médicos.'},{status:503});
 return Response.json({doctors:doctors.data,agendas:agendas.data},{headers:{'Cache-Control':'private, no-store'}});
}
export const POST=secureMutation(async request=>{
 const session=await getSession();if(!session||session.account.role!=='general_manager')throw new HttpError(403,'Acesso restrito à gerência.');
 const {kind,data}=await readJson(request);if(!['doctor','agenda'].includes(kind)||!data||typeof data!=='object'||Array.isArray(data))throw new HttpError(400,'Operação inválida.');
 const result=await getSupabaseAdmin().rpc('save_doctor_directory',{p_actor:session.account.id,p_kind:kind,p_data:data});
 if(result.error)throw new HttpError(result.error.code==='P0001'?409:400,result.error.code==='P0001'?result.error.message:'Confira os dados do cadastro.');
 return Response.json({id:result.data});
});
