import {getSession} from "@/app/authz";
import {getSupabaseAdmin} from "@/lib/supabase-admin";
import {loadBillingData} from "@/lib/billing-data";
import {secureMutation,readJson,HttpError} from "@/lib/security/http";

export const dynamic="force-dynamic";
const enabled=()=>process.env.RN_DENIALS_ENABLED==="true";
const idPattern=/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

async function allRows(table:string){
 const db=getSupabaseAdmin();const rows:Record<string,unknown>[]=[];
 for(let offset=0;;offset+=1000){
  const result=await db.from(table).select("*").order("id").range(offset,offset+999);
  if(result.error)throw new Error("Não foi possível consultar as glosas.");
  rows.push(...(result.data||[]));
  if(!result.data||result.data.length<1000)break;
 }
 return rows;
}

export async function GET(){
 if(!enabled())return Response.json({error:"Gestão de glosas aguardando homologação."},{status:404});
 const session=await getSession();
 if(!session||!["general_manager","secretary"].includes(session.account.role))
   return Response.json({error:"Acesso negado."},{status:403});
 try{
  const [billing,cases,appeals,recoveries,events]=await Promise.all([
   loadBillingData(),allRows("billing_denial_cases"),allRows("billing_denial_appeals"),
   allRows("billing_denial_recoveries"),allRows("billing_denial_events")
  ]);
  const manager=session.account.role==="general_manager";
  const authorized=billing.data.rows.filter(row=>row.record?.professional_id &&
     (manager||session.agendaIds.includes(String(row.record.professional_id))));
  const chargeById=new Map(authorized.filter(row=>row.record?.id).map(row=>[row.record!.id,row]));
  const charges=authorized.filter(row=>row.record?.id&&row.record.billing_method==="CONVENIO"&&
     row.status_atendimento==="realized").map(row=>({
      billing_record_id:row.record!.id,patient:row.patient,service_date:row.date.slice(0,10),
      procedure:row.procedure,professional_id:row.record!.professional_id,
      professional_name:billing.data.doctors.find(d=>d.id===row.record!.professional_id)?.name||"Profissional",
      entity_name:billing.data.entities.find(e=>e.id===row.record!.billing_entity_id)?.trade_name||
        billing.data.entities.find(e=>e.id===row.record!.billing_entity_id)?.name||"Entidade",
      billing_entity_id:row.record!.billing_entity_id,
      payer:row.record!.effective_payer_name_snapshot||row.record!.patient_insurance_snapshot||row.insurance
     }));
  const visibleCases=cases.filter(c=>chargeById.has(String(c.billing_record_id)));
  const validCaseIds=new Set(visibleCases.map(c=>String(c.id)));
  const validAppealIds=new Set(appeals.filter(a=>validCaseIds.has(String(a.denial_id))).map(a=>String(a.id)));
  const publicCases=visibleCases.map(c=>{
   const row=chargeById.get(String(c.billing_record_id))!;
   return {...c,
     patient:row.patient,service_date:row.date.slice(0,10),procedure:row.procedure,
     professional_id:row.record?.professional_id||"",professional_name:billing.data.doctors.find(d=>d.id===row.record?.professional_id)?.name||"Profissional",
     entity_name:billing.data.entities.find(e=>e.id===c.billing_entity_id)?.trade_name||
       billing.data.entities.find(e=>e.id===c.billing_entity_id)?.name||"Entidade",
     payer:row.record?.effective_payer_name_snapshot||row.record?.patient_insurance_snapshot||row.insurance
    };
  });
  return Response.json({charges,cases:publicCases,
    appeals:appeals.filter(a=>validCaseIds.has(String(a.denial_id))),
    recoveries:recoveries.filter(r=>validCaseIds.has(String(r.denial_id))&&validAppealIds.has(String(r.appeal_id))),
    events:events.filter(e=>validCaseIds.has(String(e.denial_id)))
      .map(e=>({id:e.id,denial_id:e.denial_id,actor_id:e.actor_id,event_type:e.event_type,created_at:e.created_at})),
    can_manage:true},{headers:{"Cache-Control":"private, no-store"}});
 }catch{return Response.json({error:"Não foi possível consultar o módulo de glosas."},{status:503});}
}

export const POST=secureMutation(async request=>{
 if(!enabled())throw new HttpError(404,"Gestão de glosas aguardando homologação.");
 const session=await getSession();
 if(!session||!["general_manager","secretary"].includes(session.account.role))
   throw new HttpError(403,"Acesso negado.");
 const payload=await readJson(request);
 if(!payload||typeof payload!=="object"||Array.isArray(payload)||
   !payload.data||typeof payload.data!=="object"||Array.isArray(payload.data))
   throw new HttpError(400,"Dados de glosa inválidos.");
 const action=payload.action;
 if(!["OPEN_CASE","FILE_APPEAL","DECIDE_APPEAL","REGISTER_RECOVERY","CLOSE_CASE"].includes(action))
   throw new HttpError(400,"Ação de glosa inválida.");
 const field=action==="OPEN_CASE"?"billing_record_id":"denial_id";
 const identifier=payload.data[field];
 if(typeof identifier!=="string"||!idPattern.test(identifier))
   throw new HttpError(400,"Identificador financeiro inválido.");
 // Restrição do banco é a autoridade final; a leitura aqui faz uma segunda verificação
 // para nunca delegar à secretária um registro de profissional não autorizado.
 if(session.account.role==="secretary"){
  const db=getSupabaseAdmin();
  let recordId=identifier;
  if(field==="denial_id"){
   const found=await db.from("billing_denial_cases").select("billing_record_id").eq("id",identifier).maybeSingle();
   if(found.error||!found.data)throw new HttpError(403,"Sem acesso à glosa.");
   recordId=found.data.billing_record_id;
  }
  const result=await db.from("billing_records").select("professional_id,billing_method").eq("id",recordId).maybeSingle();
  if(result.error||!result.data||!result.data.professional_id||
    !session.agendaIds.includes(result.data.professional_id)||result.data.billing_method!=="CONVENIO")
    throw new HttpError(403,"Sem acesso à cobrança deste profissional.");
 }
 const {data:id,error}=await getSupabaseAdmin().rpc("save_billing_denial",{
  p_actor:session.account.id,p_data:{...payload.data,action}
 });
 if(error){
  if(error.code==="P0001"||error.code==="23505")throw new HttpError(409,error.message);
  if(["23514","23502","22P02","22007","22008","22003"].includes(error.code))
    throw new HttpError(400,"Verifique valores, datas, protocolos e campos obrigatórios.");
  throw new HttpError(503,"Não foi possível registrar a operação de glosa.");
 }
 return Response.json({id});
});
