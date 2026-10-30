import {getSession} from "@/app/authz";
import {getSupabaseAdmin} from "@/lib/supabase-admin";
import {loadBillingData} from "@/lib/billing-data";
import {financialActorOrganizationId} from "@/lib/financial-organization";
import {secureMutation,readJson,HttpError} from "@/lib/security/http";
import {calculatePortalDeadline,destinationKey,matchDeadlineRule} from "@/lib/portal-deadlines";
import type {PortalDeadlineRule} from "@/lib/portal-deadlines";
import type {BillingRow} from "@/lib/billing-types";

export const dynamic="force-dynamic";
const enabled=()=>process.env.RN_PORTAL_SUBMISSIONS_ENABLED==="true";
const civilDate=(date:string|null|undefined)=>String(date||"").slice(0,10);
const localToday=()=>{
 const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
 const value=(key:string)=>parts.find(p=>p.type===key)?.value||"";
 return value("year")+"-"+value("month")+"-"+value("day");
};
async function allRows(table:string,organizationId:string){
 const db=getSupabaseAdmin();
 const rows:Record<string,unknown>[]=[];
 for(let start=0;;start+=1000){
  let query=db.from(table).select("*").order("id").range(start,start+999);
  query=query.eq("organization_id",organizationId);
  const result=await query;
  if(result.error)throw new Error("Não foi possível consultar as guias do portal.");
  rows.push(...(result.data||[]));
  if(!result.data||result.data.length<1000)break;
 }
 return rows;
}
const relevantRow=(row:BillingRow)=>
 row.record?.id && row.record.professional_id && row.record.billing_method==="CONVENIO" &&
 row.record.settlement_mode==="INVOICE" && row.status_atendimento==="realized";

export async function GET(){
 if(!enabled())return Response.json({error:"Controle de guias ainda não habilitado."},{status:404});
 const session=await getSession();
 if(!session||!["general_manager","secretary"].includes(session.account.role))return Response.json({error:"Acesso negado."},{status:403});
 const organizationId=await financialActorOrganizationId(session.account.id);
 if(!organizationId)return Response.json({error:"Acesso à organização negado."},{status:403});
 try{
  const [billing,submissions,rules]=await Promise.all([
   loadBillingData(),allRows("billing_portal_submissions",organizationId),allRows("billing_portal_deadline_rules",organizationId)
  ]);
  const byId=new Map(submissions.map(item=>[String(item.billing_record_id),item]));
  const ruleList=rules as unknown as PortalDeadlineRule[];
  const today=localToday();
  const list=billing.data.rows.filter(relevantRow).filter(row=>
    session.account.role==="general_manager" || session.agendaIds.includes(String(row.record!.professional_id)));
  const items=list.map(row=>{
    const record=row.record!;
    const submission=byId.get(record.id);
    const channel=String(submission?.submission_channel_code||
      (["PORTAL_CONVENIO","COOPERATIVA","MANUAL"].includes(String(record.submission_channel_code))?record.submission_channel_code:""));
    // Only suggest the insurer's own portal. A cooperative is NEVER inferred from the patient's insurer.
    const destination=String(submission?.destination_key ||
      (channel==="PORTAL_CONVENIO"?record.patient_insurance_snapshot||row.insurance:""));
    const rule=matchDeadlineRule(ruleList,{
      serviceDate:civilDate(row.date),destination,professionalId:String(record.professional_id),channel
    });
    const status=String(submission?.status||"PENDENTE");
    const submittedAt=submission?.submitted_at?civilDate(String(submission.submitted_at)):null;
    const deadline=calculatePortalDeadline({
      today,serviceDate:civilDate(row.date),
      guideReceivedAt:submission?.guide_received_at?civilDate(String(submission.guide_received_at)):null,
      submittedAt,rule
    });
    return {
      billing_record_id:record.id,patient:row.patient,patient_insurance:row.insurance,
      service_date:civilDate(row.date),procedure:row.procedure,professional_id:record.professional_id,
      professional_name:billing.data.doctors.find(d=>d.id===record.professional_id)?.name||"Profissional",
      billing_entity_id:record.billing_entity_id,
      entity_name:billing.data.entities.find(e=>e.id===record.billing_entity_id)?.trade_name||
        billing.data.entities.find(e=>e.id===record.billing_entity_id)?.name||"Não informada",
      status,submitted_at:submittedAt,guide_received_at:submission?.guide_received_at?civilDate(String(submission.guide_received_at)):null,
      portal_protocol:submission?.portal_protocol||null,notes:submission?.notes||"",
      destination_key:destination,submission_channel_code:channel,
      destination_confirmed:!!submission,
      deadline,rule_id:rule?.id||null,
      payment_status:row.invoice?.paid_at?"PAGO":record.payment_status
    };
  });
  // Administrative rule management does not expose any unrelated patient or billing data.
  const visibleRules=session.account.role==="general_manager"?
    ruleList:ruleList.filter(rule=>list.some(row=>row.record!.professional_id===rule.professional_id || !rule.professional_id));
  const professionals=[...new Map(list.map(row=>[String(row.record!.professional_id),{
    id:String(row.record!.professional_id),name:billing.data.doctors.find(d=>d.id===row.record!.professional_id)?.name||"Profissional"
  }])).values()].sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
  const entities=[...new Map(list.map(row=>[String(row.record!.billing_entity_id),{
    id:String(row.record!.billing_entity_id),name:billing.data.entities.find(e=>e.id===row.record!.billing_entity_id)?.trade_name||
    billing.data.entities.find(e=>e.id===row.record!.billing_entity_id)?.name||"Entidade"
  }])).values()];
  return Response.json({items,rules:visibleRules,professionals,entities,today,can_manage_rules:session.account.role==="general_manager"},
    {headers:{"Cache-Control":"private, no-store"}});
 }catch{
  return Response.json({error:"Não foi possível consultar os envios ao portal."},{status:503});
 }
}
export const POST=secureMutation(async request=>{
 if(!enabled())throw new HttpError(404,"Controle de guias ainda não habilitado.");
 const session=await getSession();
 if(!session||!["general_manager","secretary"].includes(session.account.role))throw new HttpError(403,"Acesso negado.");
 const organizationId=await financialActorOrganizationId(session.account.id);
 if(!organizationId)throw new HttpError(403,"Acesso à organização negado.");
 const payload=await readJson(request);
 if(!payload||typeof payload!=="object"||Array.isArray(payload))throw new HttpError(400,"Operação inválida.");
 const {action,data}=payload;
 if(!data||typeof data!=="object"||Array.isArray(data))throw new HttpError(400,"Dados da guia inválidos.");
 const isRule=action==="CREATE_RULE";
 if(action!=="SAVE_PENDING"&&action!=="MARK_SUBMITTED"&&!isRule)throw new HttpError(400,"Ação inválida.");
 if(isRule&&session.account.role!=="general_manager")throw new HttpError(403,"Somente a gerência configura prazos.");
 if(!isRule){
  if(typeof data.billing_record_id!=="string"||!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(data.billing_record_id))
    throw new HttpError(400,"Cobrança inválida.");
  if(session.account.role==="secretary"){
   const {data:record,error}=await getSupabaseAdmin().from("billing_records")
      .select("professional_id,billing_method,settlement_mode").eq("id",data.billing_record_id).eq("organization_id",organizationId).maybeSingle();
   if(error||!record||!record.professional_id||!session.agendaIds.includes(record.professional_id)||
      record.billing_method!=="CONVENIO"||record.settlement_mode!=="INVOICE")
    throw new HttpError(403,"Sem acesso à cobrança desse profissional.");
  }
 }
 const rpc=isRule?"save_billing_portal_rule":"save_billing_portal_submission";
 const input=isRule?data:{...data,action};
 const {data:id,error}=await getSupabaseAdmin().rpc(rpc,{p_actor:session.account.id,p_data:input});
 if(error){
  if(error.code==="P0001"||error.code==="23505")throw new HttpError(409,error.message);
  if(["23514","23502","22P02","22007","22008"].includes(error.code))throw new HttpError(400,"Revise prazos, datas e campos obrigatórios.");
  throw new HttpError(503,"Não foi possível salvar os dados do portal.");
 }
 return Response.json({id});
});
