"use client";
import {useEffect,useState} from "react";
import {formatDateBR} from "@/lib/date-format";
import PortalGuideDialog from "./portal-guide-dialog";
import PortalRuleManager from "./portal-rule-manager";
import "./portal-submissions.css";

type DeadlineState="SUBMITTED"|"NO_RULE"|"WAITING_GUIDE"|"NO_DATE"|"OVERDUE"|"ALERT"|"ON_TIME";
type PortalItem={
 billing_record_id:string;patient:string;patient_insurance:string;service_date:string;procedure:string;
 professional_id:string;professional_name:string;billing_entity_id:string;entity_name:string;
 status:string;submitted_at:string|null;guide_received_at:string|null;portal_protocol:string|null;
 notes:string;destination_key:string;submission_channel_code:string;destination_confirmed:boolean;
 deadline:{state:DeadlineState;deadline:string|null;remaining:number|null};payment_status:string;
};
type DeadlineRule={id?:string;destination_key:string;submission_channel_code:string;professional_id:string|null;
 starts_from:string;deadline_days:number;alert_before_days:number;valid_from:string;valid_to:string|null};
type PanelData={items:PortalItem[];rules:DeadlineRule[];today:string;can_manage_rules:boolean;
 entities:{id:string;name:string}[];professionals:{id:string;name:string}[]};
const statuses:Record<DeadlineState,string>={
 SUBMITTED:"Faturado no portal",NO_RULE:"Sem regra de prazo",WAITING_GUIDE:"Aguardando guia",
 NO_DATE:"Data indisponível",OVERDUE:"Prazo vencido",ALERT:"Em alerta",ON_TIME:"Dentro do prazo"
};
const fmt=(value:string|null)=>value?formatDateBR(value):"—";
async function fetchPortal():Promise<PanelData>{
 const response=await fetch("/api/billing/portal",{cache:"no-store"});
 const next=await response.json();
 if(!response.ok)throw Error(next.error||"Não foi possível consultar as guias.");
 return next;
}
export default function PortalSubmissions(){
 const [data,setData]=useState<PanelData|null>(null);
 const [editingGuide,setEditingGuide]=useState<PortalItem|null>(null);
 const [notice,setNotice]=useState("");
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(true);
 const [filter,setFilter]=useState("");
 const [term,setTerm]=useState("");
 const [entity,setEntity]=useState("");
 const [professional,setProfessional]=useState("");
 async function refresh(){
  try{setData(await fetchPortal());setError("");}
  catch(cause){setError(cause instanceof Error?cause.message:"Falha ao consultar as guias.");}
  finally{setLoading(false);}
 }
 useEffect(()=>{
  let active=true;
  void fetchPortal().then(next=>{if(active){setData(next);setError("");}})
   .catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"Falha ao consultar as guias.");})
   .finally(()=>{if(active)setLoading(false);});
  return ()=>{active=false;};
 },[]);
 const rows=(data?.items||[]).filter(row=>
  (!filter||(filter==="PENDENTE"?row.status!=="FATURADO":
    filter==="FATURADO"?row.status==="FATURADO":row.deadline.state===filter))&&
  (!entity||row.billing_entity_id===entity)&&
  (!professional||row.professional_id===professional)&&
  (!term||(row.patient+" "+row.procedure+" "+row.destination_key+" "+row.patient_insurance)
    .toLocaleLowerCase("pt-BR").includes(term.trim().toLocaleLowerCase("pt-BR")))
 );
 const count=(predicate:(row:PortalItem)=>boolean)=>(data?.items||[]).filter(predicate).length;
 return <section className="portal-submissions" aria-label="Guias de convênio">
   <div className="portal-section-heading"><div><h2>Guias e apresentação no portal</h2>
    <p>Faturado no portal é diferente de Pago. Os prazos só aparecem quando existe uma regra configurada.</p></div></div>
   {notice&&<p role="status" className="billing-message">{notice}</p>}
   {error&&<p role="alert" className="billing-error">{error} <button type="button" onClick={()=>void refresh()}>Tentar novamente</button></p>}
   {loading?<p className="billing-empty">Carregando guias…</p>:data&&<>
    <div className="portal-summary">
     <article><span>Aguardando envio</span><strong>{count(r=>r.status!=="FATURADO")}</strong></article>
     <article><span>Em alerta</span><strong>{count(r=>r.deadline.state==="ALERT")}</strong></article>
     <article><span>Prazo vencido</span><strong>{count(r=>r.deadline.state==="OVERDUE")}</strong></article>
     <article><span>Faturado no portal</span><strong>{count(r=>r.status==="FATURADO")}</strong></article>
     <article><span>Sem regra de prazo</span><strong>{count(r=>r.status!=="FATURADO"&&r.deadline.state==="NO_RULE")}</strong></article>
    </div>
    <div className="portal-filters">
     <label>Entidade<select value={entity} onChange={e=>setEntity(e.target.value)}><option value="">Todas</option>
      {data.entities.map(e=><option value={e.id} key={e.id}>{e.name}</option>)}</select></label>
     <label>Profissional<select value={professional} onChange={e=>setProfessional(e.target.value)}><option value="">Todos</option>
      {data.professionals.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
     <label>Situação<select value={filter} onChange={e=>setFilter(e.target.value)}>
      <option value="">Todas</option><option value="PENDENTE">Aguardando envio</option>
      <option value="ALERT">Em alerta</option><option value="OVERDUE">Vencido</option>
      <option value="NO_RULE">Sem regra</option><option value="FATURADO">Faturado no portal</option>
     </select></label>
     <label>Paciente ou convênio<input type="search" value={term} onChange={e=>setTerm(e.target.value)} placeholder="Buscar…"/></label>
    </div>
    <div className="portal-table-wrap"><table className="billing-table portal-table">
     <thead><tr><th>Paciente</th><th>Atendimento</th><th>Profissional / empresa</th><th>Destino</th>
      <th>Envio ao portal</th><th>Prazo</th><th>Pagamento</th><th>Ação</th></tr></thead>
     <tbody>{rows.map(row=><tr key={row.billing_record_id}>
      <td>{row.patient}<small>{row.patient_insurance}</small></td>
      <td>{fmt(row.service_date)}<small>{row.procedure}</small></td>
      <td>{row.professional_name}<small>{row.entity_name}</small></td>
      <td>{row.destination_key||"Não configurado"}</td>
      <td><span className={"portal-status "+(row.status==="FATURADO"?"submitted":"pending")}>
        {row.status==="FATURADO"?"Faturado no portal":"Aguardando envio"}</span>
       {row.submitted_at&&<small>{fmt(row.submitted_at)} · {row.portal_protocol}</small>}</td>
      <td><span className={"portal-deadline "+row.deadline.state.toLowerCase()}>{statuses[row.deadline.state]}</span>
       {row.deadline.deadline&&<small>{fmt(row.deadline.deadline)}</small>}</td>
      <td>{row.payment_status==="PAGO"?"Pago":"Pendente"}</td>
      <td><button type="button" className="billing-secondary" onClick={()=>setEditingGuide(row)}>
       {row.status==="FATURADO"?"Ver protocolo":"Registrar guia"}</button></td>
     </tr>)}</tbody>
    </table></div>
    {!rows.length&&<p className="billing-empty">Nenhuma guia encontrada com esses filtros.</p>}
    {data.can_manage_rules&&<PortalRuleManager rules={data.rules} professionals={data.professionals}
      today={data.today} onSaved={()=>{setNotice("Regra cadastrada; alertas recalculados.");void refresh();}}/>}
   </>}
   {editingGuide&&data&&<PortalGuideDialog item={editingGuide} today={data.today}
     onClose={()=>setEditingGuide(null)}
     onSaved={()=>{setEditingGuide(null);setNotice("Registro da guia salvo. O pagamento permanece independente.");void refresh();}}/>}
 </section>;
}
