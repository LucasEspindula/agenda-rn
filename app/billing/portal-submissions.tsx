"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import AppDialog from "@/components/app-dialog";
import {formatDateBR} from "@/lib/date-format";
import {destinationKey,type PortalDeadlineRule} from "@/lib/portal-deadlines";
import "./portal-submissions.css";

type Deadline={state:"SUBMITTED"|"NO_RULE"|"WAITING_GUIDE"|"NO_DATE"|"OVERDUE"|"ALERT"|"ON_TIME";deadline:string|null;remaining:number|null};
type PortalItem={
 billing_record_id:string;patient:string;patient_insurance:string;service_date:string;procedure:string;
 professional_id:string;professional_name:string;billing_entity_id:string;entity_name:string;
 status:string;submitted_at:string|null;guide_received_at:string|null;portal_protocol:string|null;
 notes:string;destination_key:string;submission_channel_code:string;destination_confirmed:boolean;
 deadline:Deadline;rule_id:string|null;payment_status:string;
};
type PortalData={items:PortalItem[];rules:PortalDeadlineRule[];professionals:{id:string;name:string}[];
 entities:{id:string;name:string}[];today:string;can_manage_rules:boolean};
type GuideDraft={destination_key:string;submission_channel_code:string;guide_received_at:string;
 submitted_at:string;portal_protocol:string;notes:string};
type RuleDraft={destination_key:string;submission_channel_code:string;professional_id:string;
 starts_from:"SERVICE_DATE"|"GUIDE_RECEIVED";deadline_days:string;alert_before_days:string;
 valid_from:string;valid_to:string};
const channels=[["PORTAL_CONVENIO","Portal do convênio"],["COOPERATIVA","Cooperativa"],["MANUAL","Canal manual"]];
const deadlineLabels:Record<Deadline["state"],string>={
 SUBMITTED:"Faturado no portal",NO_RULE:"Sem prazo configurado",WAITING_GUIDE:"Aguardando recebimento da guia",
 NO_DATE:"Data indisponível",OVERDUE:"Prazo vencido",ALERT:"Próximo do vencimento",ON_TIME:"Dentro do prazo"
};
const formatDate=(date:string|null)=>date?formatDateBR(date):"—";
const order:Record<Deadline["state"],number>={OVERDUE:0,ALERT:1,WAITING_GUIDE:2,NO_RULE:3,NO_DATE:4,ON_TIME:5,SUBMITTED:6};
export default function PortalSubmissions(){
 const [data,setData]=useState<PortalData|null>(null);
 const [loading,setLoading]=useState(true),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [entity,setEntity]=useState(""),[professional,setProfessional]=useState(""),[status,setStatus]=useState(""),
  [search,setSearch]=useState("");
 const [selected,setSelected]=useState<PortalItem|null>(null),[guide,setGuide]=useState<GuideDraft|null>(null);
 const [ruleOpen,setRuleOpen]=useState(false),[rule,setRule]=useState<RuleDraft>({
  destination_key:"",submission_channel_code:"PORTAL_CONVENIO",professional_id:"",
  starts_from:"SERVICE_DATE",deadline_days:"",alert_before_days:"",valid_from:"",valid_to:""
 });
 const [dialogError,setDialogError]=useState("");
 const load=useCallback(async()=>{
  try{
   const response=await fetch("/api/billing/portal",{cache:"no-store"});
   const content=await response.json();
   if(!response.ok)throw Error(content.error||"Não foi possível consultar as guias.");
   setData(content);setError("");
  }catch(cause){setError(cause instanceof Error?cause.message:"Falha ao consultar guias.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void load();},[load]);
 const items=data?.items||[];
 const filtered=useMemo(()=>items.filter(i=>
  (!entity||i.billing_entity_id===entity)&&(!professional||i.professional_id===professional)&&
  (!status||(status==="PENDENTE"?i.status!=="FATURADO":status==="FATURADO"?i.status==="FATURADO":i.deadline.state===status))&&
  (!search||destinationKey(i.patient+" "+i.procedure+" "+i.destination_key+" "+i.patient_insurance+" "+i.professional_name)
    .includes(destinationKey(search)))
 ).sort((a,b)=>order[a.deadline.state]-order[b.deadline.state]||a.service_date.localeCompare(b.service_date)||a.patient.localeCompare(b.patient,"pt-BR")),
 [items,entity,professional,status,search]);
 const counts={
  pending:items.filter(i=>i.status!=="FATURADO").length,
  alert:items.filter(i=>i.deadline.state==="ALERT").length,
  overdue:items.filter(i=>i.deadline.state==="OVERDUE").length,
  submitted:items.filter(i=>i.status==="FATURADO").length,
  noRule:items.filter(i=>i.status!=="FATURADO"&&i.deadline.state==="NO_RULE").length
 };
 const openGuide=(item:PortalItem)=>{
  setSelected(item);setGuide({
   destination_key:item.destination_key,submission_channel_code:item.submission_channel_code||"PORTAL_CONVENIO",
   guide_received_at:item.guide_received_at||"",submitted_at:item.submitted_at||"",
   portal_protocol:item.portal_protocol||"",notes:item.notes||""
  });setDialogError("");
 };
 async function submit(action:"SAVE_PENDING"|"MARK_SUBMITTED"){
  if(!selected||!guide||busy||selected.status==="FATURADO")return;
  if(!guide.destination_key.trim()||!guide.submission_channel_code){
   setDialogError("Informe o destino e o canal onde a guia será apresentada.");return;
  }
  if(action==="MARK_SUBMITTED"&&(!guide.guide_received_at||!guide.submitted_at||guide.portal_protocol.trim().length<3)){
   setDialogError("Para marcar como Faturado, informe recebimento da guia, data do envio e protocolo.");return;
  }
  setBusy(true);setDialogError("");
  try{
   const response=await fetch("/api/billing/portal",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action,data:{...guide,billing_record_id:selected.billing_record_id,
     destination_key:destinationKey(guide.destination_key),
     submitted_at:action==="MARK_SUBMITTED"?guide.submitted_at:null,
     portal_protocol:action==="MARK_SUBMITTED"?guide.portal_protocol:null}})});
   const result=await response.json();if(!response.ok)throw Error(result.error||"Erro ao salvar a guia.");
   setSelected(null);setGuide(null);
   setMessage(action==="MARK_SUBMITTED"?"Guia registrada como Faturada no portal. O pagamento permanece independente.":"Dados da guia atualizados.");
   await load();
  }catch(cause){setDialogError(cause instanceof Error?cause.message:"Erro ao salvar a guia.");}
  finally{setBusy(false);}
 }
 async function saveRule(){
  if(busy)return;
  if(!rule.destination_key.trim()||!rule.valid_from||!rule.deadline_days||rule.alert_before_days===""){
   setDialogError("Preencha destino, vigência, prazo e antecedência de alerta.");return;
  }
  const days=Number(rule.deadline_days),lead=Number(rule.alert_before_days);
  if(!Number.isInteger(days)||days<1||days>365||!Number.isInteger(lead)||lead<0||lead>Math.min(90,days)){
   setDialogError("Informe prazo de 1 a 365 dias e alerta de 0 a 90 dias, sem exceder o prazo.");return;
  }
  setBusy(true);setDialogError("");
  try{
   const response=await fetch("/api/billing/portal",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"CREATE_RULE",data:{...rule,professional_id:rule.professional_id||null,
     valid_to:rule.valid_to||null,destination_key:destinationKey(rule.destination_key),
     deadline_days:days,alert_before_days:lead}})});
   const result=await response.json();if(!response.ok)throw Error(result.error||"Não foi possível configurar o prazo.");
   setRuleOpen(false);setMessage("Regra de prazo criada. Os alertas foram recalculados.");
   await load();
  }catch(cause){setDialogError(cause instanceof Error?cause.message:"Erro ao configurar o prazo.");}
  finally{setBusy(false);}
 }
 return <section className="portal-submissions" aria-label="Guias de convênio e faturamento no portal">
  <div className="portal-section-heading">
   <div><h2>Guias e apresentação no portal</h2><p>O envio da guia e o pagamento do convênio são controles independentes. Os alertas dependem de uma regra cadastrada.</p></div>
   {data?.can_manage_rules&&<button type="button" className="billing-secondary"
    onClick={()=>{setRuleOpen(true);setDialogError("");setRule(r=>({...r,valid_from:data.today}));}}>+ Regra de prazo</button>}
  </div>
  {error&&<p role="alert" className="billing-error">{error} <button type="button" onClick={()=>void load()}>Tentar novamente</button></p>}
  {message&&<p role="status" className="billing-message">{message}</p>}
  {loading?<p className="billing-empty">Carregando guias…</p>:data&&<>
   <div className="portal-summary" aria-label="Resumo de guias">
    <article><span>Aguardando envio</span><strong>{counts.pending}</strong></article>
    <article><span>Em alerta</span><strong>{counts.alert}</strong></article>
    <article><span>Prazo vencido</span><strong>{counts.overdue}</strong></article>
    <article><span>Faturado no portal</span><strong>{counts.submitted}</strong></article>
    <article><span>Sem regra de prazo</span><strong>{counts.noRule}</strong></article>
   </div>
   <div className="portal-filters">
    <label>Entidade recebedora<select value={entity} onChange={e=>setEntity(e.target.value)}>
      <option value="">Todas</option>{data.entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <label>Profissional<select value={professional} onChange={e=>setProfessional(e.target.value)}>
      <option value="">Todos</option>{data.professionals.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
    <label>Situação<select value={status} onChange={e=>setStatus(e.target.value)}>
     <option value="">Todas</option><option value="PENDENTE">Aguardando envio</option>
     <option value="ALERT">Em alerta</option><option value="OVERDUE">Prazo vencido</option>
     <option value="NO_RULE">Sem regra</option><option value="FATURADO">Faturado no portal</option></select></label>
    <label>Paciente, convênio ou destino<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar…"/></label>
   </div>
   <div className="portal-table-wrap"><table className="billing-table portal-table">
    <thead><tr><th>Paciente</th><th>Atendimento</th><th>Profissional / PJ-PF</th><th>Destino da guia</th><th>Apresentação no portal</th><th>Prazo</th><th>Pagamento</th><th>Ação</th></tr></thead>
    <tbody>{filtered.map(item=><tr key={item.billing_record_id}>
     <td><strong>{item.patient}</strong><small>{item.patient_insurance||"Convênio não informado"}</small></td>
     <td>{formatDate(item.service_date)}<small>{item.procedure}</small></td>
     <td>{item.professional_name}<small>{item.entity_name}</small></td>
     <td>{item.destination_key||"Não configurado"}<small>{channels.find(c=>c[0]===item.submission_channel_code)?.[1]||"Canal não configurado"}</small></td>
     <td><span className={"portal-status "+(item.status==="FATURADO"?"submitted":"pending")}>{item.status==="FATURADO"?"Faturado no portal":"Aguardando envio"}</span>
      {item.submitted_at&&<small>{formatDate(item.submitted_at)} · {item.portal_protocol}</small>}
      {!item.submitted_at&&item.guide_received_at&&<small>Guia recebida: {formatDate(item.guide_received_at)}</small>}
     </td>
     <td><span className={"portal-deadline "+item.deadline.state.toLowerCase()}>{deadlineLabels[item.deadline.state]}</span>
       {item.deadline.deadline&&<small>{formatDate(item.deadline.deadline)}
         {item.deadline.remaining!==null&&" · "+(item.deadline.remaining<0?Math.abs(item.deadline.remaining)+"d vencido":item.deadline.remaining+"d restante")}</small>}
     </td>
     <td>{item.payment_status==="PAGO"?"Pago":"Pendente"}</td>
     <td><button type="button" className="billing-secondary" onClick={()=>openGuide(item)}>
       {item.status==="FATURADO"?"Ver protocolo":"Registrar guia"}</button></td>
    </tr>)}</tbody>
   </table></div>
   {!filtered.length&&<p className="billing-empty">Nenhuma cobrança de convênio encontrada para os filtros.</p>}
   {data.can_manage_rules&&<details className="portal-rules"><summary>Regras de prazo cadastradas ({data.rules.length})</summary>
    <p>Regras são preservadas por vigência. Não há prazo universal; datas são calculadas apenas quando a regra do destino e canal corresponde ao atendimento.</p>
    {data.rules.map((r,i)=><p key={r.id||i}><strong>{r.destination_key}</strong> · {channels.find(c=>c[0]===r.submission_channel_code)?.[1]||r.submission_channel_code}
     {r.professional_id?" · "+(data.professionals.find(d=>d.id===r.professional_id)?.name||"Profissional específico"):" · Todos os profissionais"}
     {" · "+r.deadline_days+" dias corridos · alerta "+r.alert_before_days+" dias antes · "}
     {r.starts_from==="GUIDE_RECEIVED"?"A partir do recebimento da guia":"A partir do atendimento"}
     {" · Vigência "+formatDate(r.valid_from)+" até "+(r.valid_to?formatDate(r.valid_to):"sem fim definido")}</p>)}
    {!data.rules.length&&<p>Nenhuma regra cadastrada.</p>}
   </details>}
  </>}
  {selected&&guide&&<AppDialog label="Registro de guia do convênio" busy={busy} onClose={()=>{setSelected(null);setGuide(null);}}>
   <div className="billing-section-head"><h2>{selected.status==="FATURADO"?"Guia apresentada no portal":"Registrar guia e envio ao portal"}</h2>
    <button type="button" className="billing-secondary" disabled={busy} onClick={()=>setSelected(null)}>Fechar</button></div>
   <p>{selected.patient} · {selected.professional_name} · {formatDate(selected.service_date)}</p>
   <div className="billing-form-grid">
    <label>Destino da apresentação
     <input disabled={selected.status==="FATURADO"} required maxLength={120} value={guide.destination_key}
       onChange={e=>setGuide(g=>g&&({...g,destination_key:e.target.value}))} placeholder="Ex.: UNIMED ou COOPA"/></label>
    <label>Canal de apresentação<select disabled={selected.status==="FATURADO"||
       (selected.submission_channel_code!==""&&selected.destination_confirmed&&selected.submission_channel_code!=="MANUAL")}
       value={guide.submission_channel_code} onChange={e=>setGuide(g=>g&&({...g,submission_channel_code:e.target.value}))}>
     {channels.map(c=><option key={c[0]} value={c[0]}>{c[1]}</option>)}</select></label>
    <label>Recebimento da guia pelo escritório<input disabled={selected.status==="FATURADO"} type="date"
       max={data?.today} value={guide.guide_received_at} onChange={e=>setGuide(g=>g&&({...g,guide_received_at:e.target.value}))}/></label>
    <label>Data da apresentação no portal<input disabled={selected.status==="FATURADO"} type="date"
       max={data?.today} value={guide.submitted_at} onChange={e=>setGuide(g=>g&&({...g,submitted_at:e.target.value}))}/></label>
    <label>Protocolo do portal<input disabled={selected.status==="FATURADO"} maxLength={120}
       value={guide.portal_protocol} onChange={e=>setGuide(g=>g&&({...g,portal_protocol:e.target.value}))}/></label>
   </div>
   <label>Observações<textarea disabled={selected.status==="FATURADO"} maxLength={2000} value={guide.notes}
     onChange={e=>setGuide(g=>g&&({...g,notes:e.target.value}))}/></label>
   <p className="billing-historical-note">Marcar como Faturado registra o envio ao portal; não registra pagamento nem quita nota fiscal.</p>
   {dialogError&&<p role="alert" className="billing-error">{dialogError}</p>}
   <div className="billing-modal-actions">
    <button type="button" className="billing-secondary" disabled={busy} onClick={()=>setSelected(null)}>Fechar</button>
    {selected.status!=="FATURADO"&&<>
      <button type="button" className="billing-secondary" disabled={busy} onClick={()=>void submit("SAVE_PENDING")}>Salvar dados da guia</button>
      <button type="button" className="billing-primary" disabled={busy} onClick={()=>void submit("MARK_SUBMITTED")}>Marcar Faturado no portal</button>
    </>}
   </div>
  </AppDialog>}
  {ruleOpen&&data?.can_manage_rules&&<AppDialog label="Configurar regra de prazo" busy={busy} onClose={()=>setRuleOpen(false)}>
   <div className="billing-section-head"><h2>Nova regra de prazo</h2>
    <button type="button" className="billing-secondary" disabled={busy} onClick={()=>setRuleOpen(false)}>Fechar</button></div>
   <p>Configure apenas prazos confirmados com o convênio ou cooperativa. Dias corridos; nenhuma regra é presumida.</p>
   <div className="billing-form-grid">
    <label>Destino do portal<input required maxLength={120} value={rule.destination_key} onChange={e=>setRule(r=>({...r,destination_key:e.target.value}))}/></label>
    <label>Canal<select value={rule.submission_channel_code} onChange={e=>setRule(r=>({...r,submission_channel_code:e.target.value}))}>
      {channels.map(c=><option value={c[0]} key={c[0]}>{c[1]}</option>)}</select></label>
    <label>Profissional<select value={rule.professional_id} onChange={e=>setRule(r=>({...r,professional_id:e.target.value}))}>
      <option value="">Todos</option>{data.professionals.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
    <label>Início da contagem<select value={rule.starts_from} onChange={e=>setRule(r=>({...r,starts_from:e.target.value as RuleDraft["starts_from"]}))}>
      <option value="SERVICE_DATE">Data do atendimento</option><option value="GUIDE_RECEIVED">Recebimento da guia</option></select></label>
    <label>Prazo em dias corridos<input required type="number" min="1" max="365" value={rule.deadline_days} onChange={e=>setRule(r=>({...r,deadline_days:e.target.value}))}/></label>
    <label>Alertar quantos dias antes<input required type="number" min="0" max="90" value={rule.alert_before_days} onChange={e=>setRule(r=>({...r,alert_before_days:e.target.value}))}/></label>
    <label>Vigente desde<input required type="date" value={rule.valid_from} onChange={e=>setRule(r=>({...r,valid_from:e.target.value}))}/></label>
    <label>Vigente até (opcional)<input type="date" min={rule.valid_from} value={rule.valid_to} onChange={e=>setRule(r=>({...r,valid_to:e.target.value}))}/></label>
   </div>
   {dialogError&&<p role="alert" className="billing-error">{dialogError}</p>}
   <div className="billing-modal-actions">
    <button type="button" className="billing-secondary" disabled={busy} onClick={()=>setRuleOpen(false)}>Cancelar</button>
    <button type="button" className="billing-primary" disabled={busy} onClick={()=>void saveRule()}>Salvar regra</button>
   </div>
  </AppDialog>}
 </section>;
