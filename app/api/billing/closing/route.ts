import {getSession} from "@/app/authz";
import {getSupabaseAdmin} from "@/lib/supabase-admin";
import {secureMutation,readJson,HttpError} from "@/lib/security/http";

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
async function rows(table:string,columns:string){
 const db=getSupabaseAdmin();const result:Record<string,unknown>[]=[];
 for(let offset=0;offset<100000;offset+=1000){
   const query=await db.from(table).select(columns).order("id").range(offset,offset+999);
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
  const params=new URL(request.url).searchParams;
  const entity=params.get("entity_id"),competence=params.get("month");
  if(!entity&&!competence){
    const [entities,closings]=await Promise.all([
      rows("billing_entities","id,name,trade_name,tax_id,person_type,active"),
      rows("billing_monthly_closings","id,billing_entity_id,competence_month,closed_at,closed_by,notes")
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
 const input=await readJson(request);
 if(input.action!=="CLOSE"||typeof input.entity_id!=="string"||!uuid.test(input.entity_id)||
    typeof input.month!=="string"||!month.test(input.month)||
    (input.notes!=null&&(typeof input.notes!=="string"||input.notes.length>2000)))
   throw new HttpError(400,"Informe entidade, competência e observação válida.");
 const {data,error}=await getSupabaseAdmin().rpc("close_billing_month",{
   p_actor:session.account.id,p_entity:input.entity_id,p_month:input.month,
   p_notes:input.notes||null
 });
 if(error){
  if(error.code==="P0001"||error.code==="23505")throw new HttpError(409,error.message);
  throw new HttpError(503,"Não foi possível concluir o fechamento.");
 }
 return Response.json({id:data});
});
