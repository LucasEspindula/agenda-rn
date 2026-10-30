import {getSession} from "@/app/authz";
import {getSupabaseAdmin} from "@/lib/supabase-admin";
import {financialActorOrganizationId} from "@/lib/financial-organization";
import {secureMutation,readJson,HttpError} from "@/lib/security/http";
import {verifyPassword} from "@/app/passwords";
import {consumeLimit} from "@/lib/security/rate-limit";

export const dynamic="force-dynamic";
const enabled=()=>process.env.RN_MONTHLY_CLOSING_ENABLED==="true";
const uuid=/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
const month=/^\d{4}-(0[1-9]|1[0-2])$/;

async function authorize(){
 const session=await getSession();
 if(!session||session.account.role!=="general_manager")
   throw new HttpError(403,"Somente a gerência pode consultar ou fechar uma PJ/PF.");
 return session;
}
async function rows(table:string,columns:string,organizationId:string){
 const db=getSupabaseAdmin();const result:Record<string,unknown>[]=[];
 for(let offset=0;offset<100000;offset+=1000){
   const query=await db.from(table).select(columns).eq("organization_id",organizationId).order("id").range(offset,offset+999);
   if(query.error)throw new Error("Não foi possível carregar o fechamento.");
   result.push(...(query.data||[]));
   if(!query.data||query.data.length<1000)break;
 }
 return result;
}
export async function GET(request:Request){
 if(!enabled())return Response.json({error:"Fechamento mensal ainda não homologado."},{status:404});
 try{
  const session=await authorize();
  const organizationId=await financialActorOrganizationId(session.account.id);
  if(!organizationId)throw new HttpError(403,"Acesso à organização negado.");
  const params=new URL(request.url).searchParams;
  const entity=params.get("entity_id"),competence=params.get("month");
  if(!entity&&!competence){
    const [entities,closings]=await Promise.all([
      rows("billing_entities","id,name,trade_name,tax_id,person_type,active",organizationId),
      rows("billing_monthly_closings","id,billing_entity_id,competence_month,closed_at,closed_by,notes",organizationId)
    ]);
    return Response.json({entities,closings},{headers:{"Cache-Control":"private, no-store"}});
  }
  if(!entity||!uuid.test(entity)||!competence||!month.test(competence))
    throw new HttpError(400,"Selecione uma entidade e competência válida.");
  const {data,error}=await getSupabaseAdmin().rpc("get_billing_month_closing",{
    p_actor:session.account.id,p_entity:entity,p_month:competence
  });
  if(error)throw new HttpError(error.code==="P0001"?400:503,
    error.code==="P0001"?error.message:"Não foi possível calcular o fechamento.");
  return Response.json(data,{headers:{"Cache-Control":"private, no-store"}});
 }catch(err){
  return Response.json({error:err instanceof HttpError?err.message:"Não foi possível consultar o fechamento."},
    {status:err instanceof HttpError?err.status:503,headers:{"Cache-Control":"private, no-store"}});
 }
}
export const POST=secureMutation(async request=>{
 if(!enabled())throw new HttpError(404,"Fechamento mensal ainda não homologado.");
 const session=await authorize();
 const organizationId=await financialActorOrganizationId(session.account.id);
 if(!organizationId)throw new HttpError(403,"Acesso à organização negado.");
 const input=await readJson(request);
 if(!["CLOSE","UNLOCK"].includes(input.action)||
    typeof input.entity_id!=="string"||!uuid.test(input.entity_id)||
    typeof input.month!=="string"||!month.test(input.month))
   throw new HttpError(400,"Informe entidade e competência válidas.");
 const db=getSupabaseAdmin();
 if(input.action==="UNLOCK"){
   if(typeof input.password!=="string"||input.password.length<8||input.password.length>128||
      typeof input.reason!=="string"||input.reason.trim().length<5||
      input.reason.length>2000)
     throw new HttpError(400,"Informe a senha do gerente e uma justificativa de desbloqueio.");
   await consumeLimit("monthly-closing-unlock",String(session.account.id),8,900);
   const {data:account,error:accountError}=await db.from("users")
     .select("role,password_hash,password_salt").eq("id",session.account.id).maybeSingle();
   if(accountError||!account||account.role!=="general_manager")throw new HttpError(403,"Acesso não autorizado.");
   if(!account.password_hash||!account.password_salt||
     !await verifyPassword(input.password,account.password_hash,account.password_salt))
      throw new HttpError(401,"Senha do Gerente Geral incorreta.");
   const {data,error}=await db.rpc("unlock_billing_month",{
     p_actor:session.account.id,p_entity:input.entity_id,
     p_month:input.month,p_reason:input.reason.trim()
   });
   if(error){
     if(error.code==="P0001"||error.code==="23505")throw new HttpError(409,error.message);
     throw new HttpError(503,"Não foi possível desbloquear a competência.");
   }
   return Response.json({id:data,unlocked:true});
 }
 if(input.notes!=null&&(typeof input.notes!=="string"||input.notes.length>2000))
   throw new HttpError(400,"Observação de fechamento inválida.");
 const {data,error}=await db.rpc("close_billing_month",{
   p_actor:session.account.id,p_entity:input.entity_id,p_month:input.month,
   p_notes:input.notes||null
 });
 if(error){
  if(error.code==="P0001"||error.code==="23505")throw new HttpError(409,error.message);
  throw new HttpError(503,"Não foi possível bloquear a competência.");
 }
 return Response.json({id:data,closed:true});
});
