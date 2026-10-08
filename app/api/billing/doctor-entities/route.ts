import {getSession} from '@/app/authz';
import {getSupabaseAdmin} from '@/lib/supabase-admin';

export const dynamic='force-dynamic';

export async function GET(){
 const session=await getSession();
 if(!session||session.account.role!=='general_manager')return Response.json({error:'Acesso negado.'},{status:403});
 try{
  const db=getSupabaseAdmin();
  const [entities,links]=await Promise.all([
   db.from('billing_entities').select('*'),
   db.from('billing_doctor_entities').select('*'),
  ]);
  if(entities.error||links.error)throw Error(entities.error?.message||links.error?.message||'Não foi possível carregar entidades recebedoras.');
  return Response.json({entities:entities.data||[],links:links.data||[]},{headers:{'Cache-Control':'private, no-store'}});
 }catch(error){
  return Response.json({error:error instanceof Error?error.message:'Não foi possível carregar entidades recebedoras.'},{status:503});
 }
}
