"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import {formatBRL} from "@/lib/money";
import {summarizeDenials} from "@/lib/denial-totals";
import {formatDateBR} from "@/lib/date-format";
import MobileRowActions from "@/components/mobile-row-actions";
import DenialActionDialog,{type DenialAction} from "./denial-action-dialog";
import {denialStatuses,appealDecisions,type DenialData,type DenialCase} from "@/lib/billing-denials";
import "./denials.css";

const empty:DenialData={charges:[],cases:[],appeals:[],recoveries:[],events:[],can_manage:false,today:""};
const date=(value:string|null)=>value?formatDateBR(value.slice(0,10)):"—";
const stateColors:Record<string,string>={OPEN:"open",APPEALED:"appeal",DECIDED:"decision",
 PARTIAL:"partial",RECOVERED:"recovered",CLOSED:"closed"};
const eventLabels:Record<string,string>={OPENED:"Glosa registrada",APPEAL_FILED:"Recurso apresentado",
 APPEAL_DECIDED:"Decisão recebida",RECOVERY_RECORDED:"Recuperação informada",CLOSED:"Glosa encerrada"};
async function fetchDenials():Promise<DenialData>{
 const response=await fetch("/api/billing/denials",{cache:"no-store"});
 const result=await response.json();
 if(!response.ok)throw Error(result.error||"Não foi possível consultar glosas.");
 return result;
}
export default function DenialManager(){
 const [data,setData]=useState<DenialData>(empty);
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [search,setSearch]=useState(""),[status,setStatus]=useState(""),[entity,setEntity]=useState(""),
  [professional,setProfessional]=useState("");
 const [selected,setSelected]=useState<DenialCase|null>(null);
 const [action,setAction]=useState<DenialAction|null>(null);
 const [expanded,setExpanded]=useState<string|null>(null);
 const refresh=useCallback(async()=>{
  try{setData(await fetchDenials());setError("");}
  catch(cause){setError(cause instanceof Error?cause.message:"Falha na consulta de glosas.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{
  let active=true;
  void fetchDenials().then(result=>{if(active){setData(result);setError("");}})
   .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"Falha na consulta de glosas.");})
   .finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[]);
 const all=data.cases;
 const filtered=useMemo(()=>all.filter(c=>
  (!status||c.status===status)&&(!entity||c.billing_entity_id===entity)&&
  (!professional||c.professional_id===professional)&&
  (!search||(c.patient+" "+c.professional_name+" "+c.entity_name+" "+c.payer+" "+c.reason+
    " "+(c.payer_reference||"")).toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")))
 ).sort((a,b)=>Number(a.status==="CLOSED")-Number(b.status==="CLOSED")||
   b.denied_on.localeCompare(a.denied_on)),[all,status,entity,professional,search]);
 const totals=summarizeDenials(all);
 const entities=[...new Map(data.cases.map(c=>[c.billing_entity_id,c.entity_name])).entries()];
 const doctors=[...new Map(data.cases.map(c=>[c.professional_id,c.professional_name])).entries()];
 function open(action:DenialAction,denial:DenialCase|null=null){setSelected(denial);setAction(action);}
 function close(){setSelected(null);setAction(null);}
 return <section className="denial-manager" aria-label="Gestão de glosas">
  <header className="denial-heading">
   <div><h1>Glosas e recursos</h1>
    <p>Controle de glosas por cobrança profissional, com recursos, decisões e recuperações.
      O saldo não altera automaticamente o pagamento da NF.</p></div>
   <button type="button" className="billing-primary billing-mobile-fab" aria-label="Registrar glosa" disabled={loading||!data.charges.length}
    onClick={()=>open("OPEN_CASE")}>+ Registrar glosa</button>
  </header>
  {error&&<p role="alert" className="billing-error">{error} <button type="button" onClick={()=>void refresh()}>Tentar novamente</button></p>}
  {notice&&<p role="status" className="billing-message">{notice}</p>}
  {loading?<p className="billing-empty">Carregando glosas…</p>:<>
   <div className="denial-summary">
    <article><span>Glosas registradas</span><strong>{totals.total}</strong></article>
    <article><span>Valor glosado</span><strong>{formatBRL(totals.denied)}</strong></article>
    <article><span>Recuperado informado</span><strong>{formatBRL(totals.recovered)}</strong></article>
    <article><span>Saldo ainda em acompanhamento</span><strong>{formatBRL(totals.activeBalance)}</strong></article>
    <article><span>Encerrado sem recuperação</span><strong>{formatBRL(totals.closedLoss)}</strong></article>
   </div>
   <div className="denial-filters">
    <label>Paciente, pagador ou motivo
     <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar glosa…"/></label>
    <label>Situação
     <select value={status} onChange={e=>setStatus(e.target.value)}>
      <option value="">Todas</option>{Object.entries(denialStatuses).map(([code,label])=>
       <option value={code} key={code}>{label}</option>)}</select></label>
    <label>Entidade recebedora
     <select value={entity} onChange={e=>setEntity(e.target.value)}><option value="">Todas</option>
      {entities.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label>
    <label>Profissional
     <select value={professional} onChange={e=>setProfessional(e.target.value)}><option value="">Todos</option>
      {doctors.map(([id,name])=><option value={id} key={id}>{name}</option>)}</select></label>
   </div>
   <div className="denial-table-wrap"><table className="billing-table denial-table">
    <thead><tr><th>Paciente e atendimento</th><th>Profissional / PJ-PF</th><th>Glosa</th>
      <th>Valores</th><th>Situação</th><th>Operações</th></tr></thead>
    <tbody>{filtered.map(c=>{
      const appeals=data.appeals.filter(a=>a.denial_id===c.id);
      const recoveries=data.recoveries.filter(r=>r.denial_id===c.id);
      const pending=appeals.find(a=>a.decision==="PENDING");
      const approved=appeals.some(a=>a.decision!=="PENDING"&&a.decision!=="REJECTED"&&
        Number(a.approved_amount)>recoveries.filter(r=>r.appeal_id===a.id)
          .reduce((sum,r)=>sum+Number(r.amount),0));
      const closed=c.status==="CLOSED";
      return <tr key={c.id}>
       <td><strong>{c.patient}</strong><small>{date(c.service_date)} · {c.procedure}</small>
        <small>{c.payer}</small></td>
       <td>{c.professional_name}<small>{c.entity_name}</small></td>
       <td><strong>{c.denial_kind==="TOTAL"?"Glosa total":"Glosa parcial"}</strong>
        <small>{date(c.denied_on)}</small><small>{c.reason}</small>{c.payer_reference&&<small>Referência: {c.payer_reference}</small>}</td>
       <td><strong>{formatBRL(c.denied_amount)}</strong>
        <small>Recuperado: {formatBRL(c.recovered_amount)}</small>
        <small>Restante: {formatBRL(Math.max(0,Number(c.denied_amount)-Number(c.recovered_amount)))}</small></td>
       <td><span className={"denial-status "+stateColors[c.status]}>{denialStatuses[c.status]}</span>
        <small>{appeals.length} {appeals.length===1?"recurso":"recursos"}</small></td>
       <td>
        <MobileRowActions label={"Ações de glosa para "+c.patient}>
        <div className="denial-actions">
         <button type="button" className="billing-secondary" onClick={()=>setExpanded(x=>x===c.id?null:c.id)}>
          {expanded===c.id?"Ocultar histórico":"Ver histórico"}</button>
         {!closed&&<>
          {!pending&&<button type="button" className="billing-secondary" onClick={()=>open("FILE_APPEAL",c)}>+ Recurso</button>}
          {pending&&<button type="button" className="billing-secondary" onClick={()=>open("DECIDE_APPEAL",c)}>Decisão</button>}
          {approved&&<button type="button" className="billing-secondary" onClick={()=>open("REGISTER_RECOVERY",c)}>+ Recuperação</button>}
          {!pending&&<button type="button" className="billing-secondary" onClick={()=>open("CLOSE_CASE",c)}>Encerrar</button>}
         </>}
        </div>
        </MobileRowActions>
        {expanded===c.id&&<div className="denial-history">
         <strong>Recursos e decisões</strong>
         {appeals.map(a=><p key={a.id}>
          {date(a.filed_on)} · {a.protocol} · Recorrido {formatBRL(a.appealed_amount)}
          <small>{appealDecisions[a.decision]}
           {a.decision_on?" · "+date(a.decision_on):""}
           {a.decision!=="PENDING"?" · Deferido "+formatBRL(a.approved_amount):""}</small>
         </p>)}
         {!appeals.length&&<p>Sem recurso protocolado.</p>}
         <strong>Recuperações registradas</strong>
         {recoveries.map(r=><p key={r.id}>{date(r.recovered_on)} · {formatBRL(r.amount)}
          <small>Referência: {r.receipt_reference}</small></p>)}
         {!recoveries.length&&<p>Nenhuma recuperação informada.</p>}
         <strong>Auditoria de operações</strong>
         {data.events.filter(e=>e.denial_id===c.id).map(e=><p key={e.id}>
          {eventLabels[e.event_type]||e.event_type}
          <small>{new Date(e.created_at).toLocaleString("pt-BR")} · Usuário #{e.actor_id}</small>
         </p>)}
         {c.closing_reason&&<p>Encerramento: {c.closing_reason}</p>}
        </div>}
       </td>
      </tr>;
    })}</tbody>
   </table></div>
   {!filtered.length&&<p className="billing-empty">Nenhuma glosa para os filtros.</p>}
   <p className="denial-footnote">O valor recuperado nesta tela é um indicador operacional.
     A escrituração do recebimento continua na NF/lote ou na cobrança financeira, sem duplicação.</p>
  </>}
  {action&&<DenialActionDialog action={action} denial={selected} charges={data.charges}
   appeals={data.appeals} recoveries={data.recoveries} today={data.today}
   onClose={close} onSaved={()=>{close();setNotice("Operação de glosa registrada com histórico.");void refresh();}}/>}
 </section>;
}
