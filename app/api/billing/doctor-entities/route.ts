import {getSession} from '@/app/authz';
import {getSupabaseAdmin} from '@/lib/supabase-admin';
import {financialActorOrganizationId} from '@/lib/financial-organization';

export const dynamic='force-dynamic';

export async function GET(){
 const session=await getSession();
 if(!session||session.account.role!=='general_manager')return Response.json({error:'Acesso negado.'},{status:403});
 const organizationId=await financialActorOrganizationId(session.account.id);
 if(!organizationId)return Response.json({error:'Acesso à organização negado.'},{status:403});
 try{
  const db=getSupabaseAdmin();
  const [entities,links]=await Promise.all([
   db.from('billing_entities').select('*').eq('organization_id',organizationId),
   db.from('billing_doctor_entities').select('*').eq('organization_id',organizationId),
  ]);
  if(entities.error||links.error)throw Error('Não foi possível carregar entidades recebedoras.');
  return Response.json({entities:entities.data||[],links:links.data||[]},{headers:{'Cache-Control':'private, no-store'}});
 }catch{
  return Response.json({error:'Não foi possível carregar entidades recebedoras.'},{status:503});
 }
}
