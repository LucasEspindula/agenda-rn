import {getSession} from "@/app/authz";
import {getSupabaseAdmin} from "@/lib/supabase-admin";
import {financialActorOrganizationId} from "@/lib/financial-organization";
export const dynamic="force-dynamic";
export async function GET(){
 const session=await getSession();
 if(!session||!["general_manager","secretary"].includes(session.account.role))
  return Response.json({error:"Acesso negado."},{status:403});
 const organizationId=await financialActorOrganizationId(session.account.id);
 if(!organizationId)return Response.json({error:"Acesso à organização negado."},{status:403});
 const {data,error}=await getSupabaseAdmin().from("users")
  .select("id,name,role,organization_memberships!inner(organization_id)")
  .eq("role","general_manager")
  .eq("organization_memberships.organization_id",organizationId).order("name");
 if(error)return Response.json({error:"Não foi possível consultar os responsáveis."},{status:503});
 return Response.json({managers:(data||[]).map((row:{id:number;name:string})=>({id:row.id,name:row.name}))},{
  headers:{"Cache-Control":"private, no-store"}});
}
