"use client";
import {useState,type FormEvent} from "react";
import AppDialog from "@/components/app-dialog";
import MoneyInput from "@/components/money-input";
import {formatBRL,parseBRL} from "@/lib/money";
import {formatDateBR} from "@/lib/date-format";
import type {DenialCharge,DenialCase,DenialAppeal,DenialRecovery} from "@/lib/billing-denials";

export type DenialAction="OPEN_CASE"|"FILE_APPEAL"|"DECIDE_APPEAL"|"REGISTER_RECOVERY"|"CLOSE_CASE";
const labels:Record<DenialAction,string>={
 OPEN_CASE:"Registrar glosa",FILE_APPEAL:"Apresentar recurso",DECIDE_APPEAL:"Registrar decisão",
 REGISTER_RECOVERY:"Registrar recuperação",CLOSE_CASE:"Encerrar glosa"
};
export default function DenialActionDialog({
 action,denial,charges,appeals,recoveries,today,onClose,onSaved
}:{
 action:DenialAction;denial:DenialCase|null;charges:DenialCharge[];
 appeals:DenialAppeal[];recoveries:DenialRecovery[];today:string;
 onClose:()=>void;onSaved:()=>void;
}){
 const [chargeId,setChargeId]=useState("");
 const [date,setDate]=useState(today);
 const [amount,setAmount]=useState("");
 const [reason,setReason]=useState("");
 const [denialKind,setDenialKind]=useState<"TOTAL"|"PARCIAL">("PARCIAL");
 const [protocol,setProtocol]=useState("");
 const [notes,setNotes]=useState("");
 const [decision,setDecision]=useState<"ACCEPTED"|"PARTIAL"|"REJECTED">("REJECTED");
 const [appealId,setAppealId]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const applicableAppeals=appeals.filter(a=>a.denial_id===denial?.id);
 const waiting=applicableAppeals.filter(a=>a.decision==="PENDING");
 const approved=applicableAppeals.filter(a=>a.decision==="ACCEPTED"||a.decision==="PARTIAL").filter(a=>
   recoveries.filter(r=>r.appeal_id===a.id).reduce((sum,r)=>sum+Number(r.amount),0)<Number(a.approved_amount));
 const candidates=action==="DECIDE_APPEAL"?waiting:approved;
 const chosenAppeal=candidates.find(a=>a.id===(appealId||candidates[0]?.id));
 const selectedCharge=charges.find(c=>c.billing_record_id===chargeId);
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy)return;
  const data:Record<string,unknown>={};
  if(action==="OPEN_CASE"){
   if(!selectedCharge){setError("Selecione uma cobrança de convênio.");return;}
   data.billing_record_id=chargeId;data.denied_on=date;data.denial_kind=denialKind;
   data.reason=reason;data.payer_reference=protocol;data.notes=notes;
  }else{
   if(!denial)return;
   data.denial_id=denial.id;data.updated_at=denial.updated_at;
   if(action==="FILE_APPEAL"){
    data.filed_on=date;data.protocol=protocol;data.notes=notes;
   }else if(action==="DECIDE_APPEAL"){
    if(!chosenAppeal){setError("Nenhum recurso pendente.");return;}
    data.appeal_id=chosenAppeal.id;data.decision=decision;
    data.decision_on=date;data.notes=notes;
   }else if(action==="REGISTER_RECOVERY"){
    if(!chosenAppeal){setError("Não existe decisão deferida com valor disponível.");return;}
    data.appeal_id=chosenAppeal.id;data.recovered_on=date;
    data.receipt_reference=protocol;data.notes=notes;
   }else if(action==="CLOSE_CASE"){
    data.closing_reason=reason;
   }
  }
  if(["OPEN_CASE","FILE_APPEAL","REGISTER_RECOVERY"].includes(action)||
     action==="DECIDE_APPEAL"&&decision!=="REJECTED"){
   try{
    const n=parseBRL(amount);
    if(n==null||n<0||(action!=="DECIDE_APPEAL"&&n===0))throw Error("Valor inválido.");
    if(action==="OPEN_CASE")data.denied_amount=n;
    if(action==="FILE_APPEAL")data.appealed_amount=n;
    if(action==="DECIDE_APPEAL")data.approved_amount=n;
    if(action==="REGISTER_RECOVERY")data.amount=n;
   }catch{setError("Informe o valor em reais no formato correto.");return;}
  }
  if(action==="DECIDE_APPEAL"&&decision==="REJECTED")data.approved_amount=0;
  setError("");setBusy(true);
  try{
   const response=await fetch("/api/billing/denials",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action,data})
   });
   const result=await response.json();
   if(!response.ok)throw Error(result.error||"Não foi possível registrar a glosa.");
   onSaved();
  }catch(cause){setError(cause instanceof Error?cause.message:"Erro no registro da glosa.");}
  finally{setBusy(false);}
 }
 return <AppDialog label={labels[action]} busy={busy} onClose={onClose}>
  <div className="billing-section-head"><h2>{labels[action]}</h2>
   <button type="button" className="billing-secondary" disabled={busy} onClick={onClose}>Fechar</button></div>
  {denial&&<p>{denial.patient} · {denial.professional_name} · Glosa {formatBRL(denial.denied_amount)}</p>}
  <form onSubmit={e=>void submit(e)}>
   <div className="billing-form-grid">
    {action==="OPEN_CASE"&&<>
     <label>Tipo de glosa
      <select value={denialKind} onChange={e=>setDenialKind(e.target.value as "TOTAL"|"PARCIAL")}>
       <option value="PARCIAL">Glosa parcial</option><option value="TOTAL">Glosa total</option>
      </select>
     </label>
     <label>Cobrança profissional
      <select required value={chargeId} onChange={e=>setChargeId(e.target.value)}>
       <option value="">Selecione a cobrança</option>
       {charges.map(c=><option key={c.billing_record_id} value={c.billing_record_id}>
        {c.patient} · {c.professional_name} · {formatDateBR(c.service_date)} · {c.payer}
       </option>)}
      </select></label>
     {selectedCharge&&<p className="denial-context">{selectedCharge.entity_name} · {selectedCharge.procedure}</p>}
    </>}
    {action==="DECIDE_APPEAL"||action==="REGISTER_RECOVERY"?<label>Recurso
     <select value={appealId||candidates[0]?.id||""} required onChange={e=>setAppealId(e.target.value)}>
      {candidates.map(a=><option key={a.id} value={a.id}>{a.protocol} · {formatDateBR(a.filed_on)} · {formatBRL(a.appealed_amount)}</option>)}
     </select></label>:null}
    {action==="DECIDE_APPEAL"&&<label>Decisão da operadora
     <select value={decision} onChange={e=>{setDecision(e.target.value as "ACCEPTED"|"PARTIAL"|"REJECTED");setAmount("");}}>
      <option value="REJECTED">Indeferido</option><option value="PARTIAL">Parcialmente deferido</option>
      <option value="ACCEPTED">Deferido</option>
     </select></label>}
    {action!=="CLOSE_CASE"&&<label>{
      action==="OPEN_CASE"?"Data da glosa":action==="FILE_APPEAL"?"Data do recurso":
      action==="DECIDE_APPEAL"?"Data da decisão":"Data da recuperação"}
     <input type="date" required max={today} value={date} onChange={e=>setDate(e.target.value)}/></label>}
    {(action==="OPEN_CASE"||action==="FILE_APPEAL"||action==="REGISTER_RECOVERY"||
      action==="DECIDE_APPEAL"&&decision!=="REJECTED")&&
      <label>{
       action==="OPEN_CASE"?"Valor glosado":action==="FILE_APPEAL"?"Valor recorrido":
       action==="REGISTER_RECOVERY"?"Valor recuperado":"Valor deferido"}
       <MoneyInput required value={amount} onChange={setAmount}/></label>}
    {action==="OPEN_CASE"||action==="CLOSE_CASE"?<label>{
      action==="OPEN_CASE"?"Motivo informado pela operadora":"Motivo de encerramento"}
     <textarea minLength={5} maxLength={action==="OPEN_CASE"?2000:1000} required value={reason} onChange={e=>setReason(e.target.value)}/>
    </label>:null}
    {(action==="OPEN_CASE"||action==="FILE_APPEAL"||action==="REGISTER_RECOVERY")&&
      <label>{action==="OPEN_CASE"?"Referência da glosa (opcional)":
       action==="FILE_APPEAL"?"Protocolo do recurso":"Comprovante/referência da recuperação"}
       <input maxLength={120} required={action!=="OPEN_CASE"} value={protocol} onChange={e=>setProtocol(e.target.value)}/>
      </label>}
   </div>
   {action!=="CLOSE_CASE"&&<label>Observações
    <textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>}
   {action==="REGISTER_RECOVERY"&&<p className="billing-historical-note">
    Recuperação registrada na glosa não gera pagamento em duplicidade. A conciliação financeira continua na NF/lote.</p>}
   {action==="CLOSE_CASE"&&<p className="billing-historical-note">
    Encerramento preserva recursos, decisões e recuperações. Não exclui o histórico.</p>}
   {error&&<p role="alert" className="billing-error">{error}</p>}
   <div className="billing-modal-actions">
    <button type="button" className="billing-secondary" disabled={busy} onClick={onClose}>Cancelar</button>
    <button type="submit" className="billing-primary" disabled={busy||(
       (action==="DECIDE_APPEAL"||action==="REGISTER_RECOVERY")&&!chosenAppeal)}>
      {busy?"Salvando…":labels[action]}</button>
   </div>
  </form>
 </AppDialog>;
}
