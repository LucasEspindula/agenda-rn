"use client";
import {useState} from "react";
import AppDialog from "@/components/app-dialog";
import {formatDateBR} from "@/lib/date-format";

type Rule={id?:string;destination_key:string;submission_channel_code:string;professional_id:string|null;
 starts_from:string;deadline_days:number;alert_before_days:number;valid_from:string;valid_to:string|null};
type RuleForm={destination_key:string;submission_channel_code:string;professional_id:string;
 starts_from:string;deadline_days:string;alert_before_days:string;valid_from:string;valid_to:string};
const channelOptions=[["PORTAL_CONVENIO","Portal do convênio"],["COOPERATIVA","Cooperativa"],["MANUAL","Canal manual"]];
export default function PortalRuleManager({rules,professionals,today,onSaved}:{
 rules:Rule[];professionals:{id:string;name:string}[];today:string;onSaved:()=>void;
}){
 const [open,setOpen]=useState(false);
 const [form,setForm]=useState<RuleForm>({
  destination_key:"",submission_channel_code:"PORTAL_CONVENIO",professional_id:"",
  starts_from:"SERVICE_DATE",deadline_days:"",alert_before_days:"",valid_from:today,valid_to:""
 });
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 function update(key:keyof RuleForm,value:string){setForm(old=>({...old,[key]:value}));}
 async function save(){
  if(busy)return;
  const days=Number(form.deadline_days),alert=Number(form.alert_before_days);
  if(!form.destination_key.trim()||!form.valid_from||!form.deadline_days||form.alert_before_days===""||
   !Number.isInteger(days)||days<1||days>365||!Number.isInteger(alert)||alert<0||alert>90||alert>days){
   setError("Informe destino, vigência, prazo válido e antecedência do alerta.");return;
  }
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/billing/portal",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"CREATE_RULE",data:{
     ...form,professional_id:form.professional_id||null,valid_to:form.valid_to||null,
     destination_key:form.destination_key.trim().toLocaleUpperCase("pt-BR"),
     deadline_days:days,alert_before_days:alert
    }})
   });
   const result=await response.json();
   if(!response.ok)throw Error(result.error||"Não foi possível cadastrar o prazo.");
   setOpen(false);onSaved();
  }catch(cause){setError(cause instanceof Error?cause.message:"Falha ao salvar regra de prazo.");}
  finally{setBusy(false);}
 }
 const date=(s:string|null)=>s?formatDateBR(s):"sem término";
 return <section className="portal-rules" aria-label="Regras de prazo do faturamento no portal">
   <div className="portal-section-heading">
    <div><h3>Regras de prazo</h3><p>Nenhum prazo é presumido. Cadastre somente regras confirmadas com o convênio ou cooperativa.</p></div>
    <button type="button" className="billing-secondary" onClick={()=>{setOpen(true);setError("");}}>+ Nova regra</button>
   </div>
   <details><summary>Consultar regras cadastradas ({rules.length})</summary>
    {rules.map((rule,i)=><p key={rule.id||i}>
     <strong>{rule.destination_key}</strong> · {channelOptions.find(c=>c[0]===rule.submission_channel_code)?.[1]||rule.submission_channel_code}
     {" · "+(rule.professional_id?professionals.find(p=>p.id===rule.professional_id)?.name||"Profissional específico":"Todos os profissionais")}
     {" · "+rule.deadline_days+" dias corridos, alerta "+rule.alert_before_days+" dias antes"}
     {" · A partir de "+(rule.starts_from==="GUIDE_RECEIVED"?"recebimento da guia":"atendimento")}
     {" · Vigência de "+date(rule.valid_from)+" até "+date(rule.valid_to)}
    </p>)}
    {!rules.length&&<p>Não há regras cadastradas.</p>}
   </details>
   {open&&<AppDialog label="Nova regra de prazo da guia" busy={busy} onClose={()=>setOpen(false)}>
    <div className="billing-section-head"><h2>Nova regra de prazo</h2>
     <button type="button" className="billing-secondary" disabled={busy} onClick={()=>setOpen(false)}>Fechar</button></div>
    <p>Os alertas são calculados em dias corridos. Não use uma regra sem confirmação contratual.</p>
    <div className="billing-form-grid">
     <label>Destino do portal<input maxLength={120} required value={form.destination_key}
       onChange={e=>update("destination_key",e.target.value)} placeholder="Ex.: UNIMED"/></label>
     <label>Canal<select value={form.submission_channel_code} onChange={e=>update("submission_channel_code",e.target.value)}>
       {channelOptions.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
     <label>Profissional<select value={form.professional_id} onChange={e=>update("professional_id",e.target.value)}>
       <option value="">Todos</option>{professionals.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
     <label>Contar prazo a partir de<select value={form.starts_from} onChange={e=>update("starts_from",e.target.value)}>
       <option value="SERVICE_DATE">Data do atendimento</option>
       <option value="GUIDE_RECEIVED">Recebimento da guia</option></select></label>
     <label>Prazo (dias corridos)<input type="number" min="1" max="365" required value={form.deadline_days}
       onChange={e=>update("deadline_days",e.target.value)}/></label>
     <label>Alerta antes do prazo (dias)<input type="number" min="0" max="90" required value={form.alert_before_days}
       onChange={e=>update("alert_before_days",e.target.value)}/></label>
     <label>Vigente desde<input type="date" required value={form.valid_from} onChange={e=>update("valid_from",e.target.value)}/></label>
     <label>Vigente até (opcional)<input type="date" min={form.valid_from} value={form.valid_to}
       onChange={e=>update("valid_to",e.target.value)}/></label>
    </div>
    {error&&<p role="alert" className="billing-error">{error}</p>}
    <div className="billing-modal-actions">
     <button type="button" className="billing-secondary" disabled={busy} onClick={()=>setOpen(false)}>Cancelar</button>
     <button type="button" className="billing-primary" disabled={busy} onClick={()=>void save()}>Cadastrar prazo</button>
    </div>
   </AppDialog>}
  </section>;
}
