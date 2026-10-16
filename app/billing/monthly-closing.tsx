"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import AppDialog from "@/components/app-dialog";
import {formatBRL} from "@/lib/money";
import {formatDateBR} from "@/lib/date-format";
import "./monthly-closing.css";

type Entity={id:string;name:string;trade_name:string|null;tax_id:string;person_type:string;active:boolean};
type History={id:string;billing_entity_id:string;competence_month:string;closed_at:string;closed_by:number;notes:string|null};
type Professional={professional_id:string;professional_name:string;charges:number;attendances:number;
 private_charges:number;insurance_charges:number;pending_charges_now:number;attributed_invoice_items:number};
type Invoice={id:string;invoice_number:string;payer:string;issue_date:string;paid_at:string|null;
 recipient_type:string;total_amount:number|null;net_amount:number|null};
type DirectPayment={id:string;attendance_id:string;professional_id:string;professional_name:string;
 paid_at:string;received_amount:number|null;billing_method:string};
type Expense={id:string;description:string;category:string;competence_date:string;paid_at:string|null;
 amount:number;status:string;supplier:string};
type Denial={id:string;billing_record_id:string;denial_kind:string;denied_on:string;
 denied_amount:number;recovered_amount:number;status:string;reason:string};
type Snapshot={
 entity:Entity;competence:string;period_start:string;period_end_exclusive:string;
 production:{attendances:number;charges:number;professionals:number;private_charges:number;
  insurance_charges:number;pending_charges_now:number;unpriced_charges:number};
 professionals:Professional[];
 issued_invoices:{count:number;gross_total:number;net_total:number;without_net_amount:number;
  insurance_count:number;private_count:number};
 invoices:Invoice[];
 cash:{direct_received:number;insurance_invoice_received:number;insurance_paid_invoices_without_net:number};
 direct_payments:DirectPayment[];
 expenses:{competence_total:number;paid_total:number};expense_items:Expense[];
 denials:{denied_in_month:number;recovered_in_month:number;loss_on_cases_opened_in_month_now:number};
 denial_items:Denial[];
 pending_now:{unpaid_invoice_count:number;unpaid_invoice_net:number;unpaid_invoice_unknown_net:number};
 notices:string[];
};
type Closing={id:string;snapshot:Snapshot;closed_at:string;closed_by:number;notes:string|null;changed_since_close:boolean};
type Preview={current:Snapshot;closed:boolean;closing:Closing|null};
const date=(v:string|null|undefined)=>v?formatDateBR(v.slice(0,10)):"—";
const cash=(n:number|null|undefined)=>formatBRL(n??0);
const previousMonth=()=>{
 const now=new Date();
 return new Date(now.getFullYear(),now.getMonth()-1,1).toLocaleDateString("en-CA",{year:"numeric",month:"2-digit"}).slice(0,7);
};

export default function MonthlyClosing(){
 const [entities,setEntities]=useState<Entity[]>([]);
 const [history,setHistory]=useState<History[]>([]);
 const [entity,setEntity]=useState("");
 const [month,setMonth]=useState(previousMonth);
 const [preview,setPreview]=useState<Preview|null>(null);
 const [showCurrent,setShowCurrent]=useState(false);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [showCloseDialog,setShowCloseDialog]=useState(false);
 const [notes,setNotes]=useState("");
 const [loadedKey,setLoadedKey]=useState("");
 const reloadOptions=useCallback(async()=>{
  const response=await fetch("/api/billing/closing",{cache:"no-store"});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||"Não foi possível carregar entidades.");
  setEntities(result.entities);setHistory(result.closings);
  setEntity(current=>current||result.entities[0]?.id||"");
 },[]);
 const loadPreview=useCallback(async(id:string,competence:string)=>{
  setPreview(null);setLoadedKey("");if(!id||!competence)return;
  setLoading(true);
  try{
   const response=await fetch("/api/billing/closing?entity_id="+encodeURIComponent(id)+
     "&month="+encodeURIComponent(competence),{cache:"no-store"});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||"Não foi possível calcular o fechamento.");
   setPreview(result);setLoadedKey(id+"|"+competence);setError("");setShowCurrent(false);
  }catch(cause){setError(cause instanceof Error?cause.message:"Falha ao consultar fechamento.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void reloadOptions().catch(cause=>{
  setError(cause instanceof Error?cause.message:"Falha ao consultar fechamento.");setLoading(false);
 });},[reloadOptions]);
 useEffect(()=>{void loadPreview(entity,month);},[entity,month,loadPreview]);
 const valid=!!preview&&loadedKey===entity+"|"+month;
 const data=valid?(preview!.closed&&!showCurrent?preview!.closing?.snapshot||preview!.current:preview!.current):null;
 const totalCash=(data?.cash.direct_received||0)+(data?.cash.insurance_invoice_received||0);
 const netCash=totalCash-(data?.expenses.paid_total||0);
 const selectedEntity=entities.find(e=>e.id===entity);
 const priorHistory=history.filter(h=>h.billing_entity_id===entity).sort((a,b)=>b.competence_month.localeCompare(a.competence_month));
 const nowMonth=new Date().toLocaleDateString("en-CA",{year:"numeric",month:"2-digit"}).slice(0,7);
 const canClose=valid&&!preview!.closed&&month<nowMonth&&
  data?.issued_invoices.without_net_amount===0&&
  data?.cash.insurance_paid_invoices_without_net===0;
 const warnings=useMemo(()=>{
  if(!data)return [];
  const w:string[]=[];
  if(data.production.unpriced_charges>0)w.push(data.production.unpriced_charges+
    " cobranças da competência ainda sem valor individual identificado.");
  if(data.issued_invoices.without_net_amount>0)w.push("Há NFs emitidas sem valor líquido.");
  if(data.cash.insurance_paid_invoices_without_net>0)w.push("Há NFs recebidas sem valor líquido.");
  if(data.pending_now.unpaid_invoice_count>0)w.push("Existem NFs emitidas nesta competência ainda não pagas.");
  return w;
 },[data]);
 async function closeMonth(){
  if(busy||!canClose)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/billing/closing",{method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"CLOSE",entity_id:entity,month,notes})});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||"Não foi possível encerrar a competência.");
   await Promise.all([reloadOptions(),loadPreview(entity,month)]);
   setShowCloseDialog(false);setNotes("");
   setNotice("Competência fechada. O retrato histórico é imutável.");
  }catch(cause){setError(cause instanceof Error?cause.message:"Erro ao fechar competência.");}
  finally{setBusy(false);}
 }
 return <section className="monthly-closing" aria-label="Fechamento mensal por PJ/PF">
  <header className="monthly-heading no-print">
   <div><h1>Fechamento mensal por PJ/PF</h1>
    <p>Selecione a entidade recebedora e a competência. Produção, NFs, caixa e glosas usam datas diferentes e não duplicam recebimentos.</p>
   </div>
   <button type="button" className="billing-secondary" disabled={!valid}
     onClick={()=>window.print()}>Imprimir / Salvar em PDF</button>
  </header>
  <div className="monthly-filters no-print">
   <label>Entidade recebedora
    <select value={entity} onChange={e=>{setEntity(e.target.value);setNotice("");}}>
     <option value="">Selecione</option>
     {entities.map(e=><option value={e.id} key={e.id}>
      {e.trade_name||e.name} — {e.tax_id}</option>)}
    </select>
   </label>
   <label>Competência
    <input type="month" value={month} onChange={e=>{setMonth(e.target.value);setNotice("");}}/>
   </label>
   <button type="button" className="billing-secondary" disabled={!entity||!month||loading}
    onClick={()=>void loadPreview(entity,month)}>Atualizar prévia</button>
  </div>
  {error&&<p role="alert" className="billing-error">{error}</p>}
  {notice&&<p role="status" className="billing-message">{notice}</p>}
  {loading&&!valid?<p className="billing-empty">Calculando competência…</p>:null}
  {data&&<>
   <div className="monthly-report-heading">
    <div><h2>{data.entity.trade_name||data.entity.name}</h2>
     <p>{data.entity.person_type||"Entidade"} · {data.entity.tax_id} · Competência {month}</p></div>
    <div className="monthly-report-status">
      <strong>{preview?.closed&&!showCurrent?"Fechamento histórico":"Prévia atual"}</strong>
      {preview?.closing&&!showCurrent&&<small>Fechado em {new Date(preview.closing.closed_at).toLocaleString("pt-BR")}
       {preview.closing.notes?" · "+preview.closing.notes:""}</small>}
    </div>
   </div>
   {preview?.closed&&<div className="monthly-history-alert no-print">
    <strong>Competência já fechada.</strong>
    {preview.closing?.changed_since_close?
      " Os dados atuais diferem do retrato fechado. O fechamento original será preservado.":
      " O retrato está consistente com os dados atuais."}
    <div className="monthly-view-actions">
     <button type="button" className="billing-secondary" onClick={()=>setShowCurrent(false)}
      aria-pressed={!showCurrent}>Ver fechamento original</button>
     <button type="button" className="billing-secondary" onClick={()=>setShowCurrent(true)}
      aria-pressed={showCurrent}>Comparar com dados atuais</button>
    </div>
   </div>}
   <div className="monthly-summary">
    <article><span>Atendimentos realizados</span><strong>{data.production.attendances}</strong>
      <small>{data.production.charges} cobranças · {data.production.professionals} profissionais</small></article>
    <article><span>NFs emitidas (líquido)</span><strong>{cash(data.issued_invoices.net_total)}</strong>
     <small>{data.issued_invoices.count} documentos por data de emissão</small></article>
    <article><span>Recebimentos no mês</span><strong>{cash(totalCash)}</strong>
     <small>Pagamentos diretos + NFs de convênio, uma vez por NF</small></article>
    <article><span>Despesas pagas</span><strong>{cash(data.expenses.paid_total)}</strong>
      <small>Competência das despesas: {cash(data.expenses.competence_total)}</small></article>
    <article><span>Resultado de caixa</span><strong>{cash(netCash)}</strong>
      <small>Recebimentos menos despesas efetivamente pagas</small></article>
    <article><span>Glosas do mês</span><strong>{cash(data.denials.denied_in_month)}</strong>
      <small>Recuperações informadas: {cash(data.denials.recovered_in_month)} (não somadas ao caixa)</small></article>
   </div>
   <section className="monthly-panel">
    <h3>Produção por profissional — data do atendimento</h3>
    <p className="monthly-explanation">Os valores por profissional são itens identificados em NFs e não devem ser somados novamente aos recebimentos da entidade.</p>
    <div className="monthly-scroll"><table className="billing-table">
     <thead><tr><th>Profissional</th><th>Atendimentos</th><th>Cobranças</th>
       <th>Particular</th><th>Convênio</th><th>Pendentes hoje</th><th>Itens de NF atribuídos</th></tr></thead>
     <tbody>{data.professionals.map(p=><tr key={p.professional_id}>
      <td>{p.professional_name}</td><td>{p.attendances}</td><td>{p.charges}</td>
      <td>{p.private_charges}</td><td>{p.insurance_charges}</td><td>{p.pending_charges_now}</td>
      <td>{cash(p.attributed_invoice_items)}</td></tr>)}</tbody>
    </table></div>
    {!data.professionals.length&&<p>Sem produção registrada para esta competência.</p>}
   </section>
   <section className="monthly-panel">
    <h3>Entradas financeiras — data do pagamento</h3>
    <div className="monthly-pair">
     <p><strong>Pagamento direto:</strong> {cash(data.cash.direct_received)}</p>
     <p><strong>NFs de convênio recebidas:</strong> {cash(data.cash.insurance_invoice_received)}</p>
    </div>
    <details><summary>Consultar pagamentos diretos ({data.direct_payments.length})</summary>
     <div className="monthly-scroll"><table className="billing-table">
      <thead><tr><th>Profissional</th><th>Pagamento</th><th>Forma de cobrança</th><th>Valor recebido</th></tr></thead>
      <tbody>{data.direct_payments.map(p=><tr key={p.id}>
       <td>{p.professional_name}</td><td>{date(p.paid_at)}</td><td>{p.billing_method}</td>
       <td>{cash(p.received_amount)}</td></tr>)}</tbody></table></div>
    </details>
   </section>
   <section className="monthly-panel">
    <h3>Relação de NFs — emissão ou recebimento no mês</h3>
    <p className="monthly-explanation">O total emitido considera a data de emissão; o caixa considera a data do recebimento. Uma NF com vários pacientes aparece somente uma vez.</p>
    <div className="monthly-scroll"><table className="billing-table">
     <thead><tr><th>NF</th><th>Pagador / tomador</th><th>Emissão</th><th>Pagamento</th>
       <th>Bruto</th><th>Líquido</th><th>Tipo</th></tr></thead>
     <tbody>{data.invoices.map(i=><tr key={i.id}>
      <td>{i.invoice_number}</td><td>{i.payer}</td><td>{date(i.issue_date)}</td><td>{date(i.paid_at)}</td>
      <td>{cash(i.total_amount)}</td><td>{i.net_amount==null?"Não informado":cash(i.net_amount)}</td>
      <td>{i.recipient_type}</td></tr>)}</tbody></table></div>
    {!data.invoices.length&&<p>Nenhuma NF emitida ou recebida nesta competência.</p>}
   </section>
   <section className="monthly-panel">
    <h3>Despesas — competência e pagamento separados</h3>
    <div className="monthly-scroll"><table className="billing-table">
     <thead><tr><th>Descrição</th><th>Categoria</th><th>Competência</th><th>Pago em</th><th>Status</th><th>Valor</th></tr></thead>
     <tbody>{data.expense_items.map(e=><tr key={e.id}>
      <td>{e.description}</td><td>{e.category}</td><td>{date(e.competence_date)}</td>
      <td>{date(e.paid_at)}</td><td>{e.status}</td><td>{cash(e.amount)}</td></tr>)}</tbody>
    </table></div>
   </section>
   <section className="monthly-panel">
    <h3>Glosas e pendências</h3>
    <div className="monthly-pair">
     <p><strong>Valor glosado no mês:</strong> {cash(data.denials.denied_in_month)}</p>
     <p><strong>Recuperado informado no mês:</strong> {cash(data.denials.recovered_in_month)}</p>
     <p><strong>Perda em casos encerrados desta competência (posição atual):</strong> {cash(data.denials.loss_on_cases_opened_in_month_now)}</p>
     <p><strong>NFs sem pagamento (situação atual):</strong> {data.pending_now.unpaid_invoice_count}
        {" · "+cash(data.pending_now.unpaid_invoice_net)}</p>
    </div>
    <details><summary>Consultar glosas registradas na competência ({data.denial_items.length})</summary>
     <div className="monthly-scroll"><table className="billing-table">
      <thead><tr><th>Data</th><th>Tipo</th><th>Motivo</th><th>Glosado</th><th>Recuperado acumulado</th><th>Situação</th></tr></thead>
      <tbody>{data.denial_items.map(g=><tr key={g.id}>
       <td>{date(g.denied_on)}</td><td>{g.denial_kind}</td><td>{g.reason}</td>
       <td>{cash(g.denied_amount)}</td><td>{cash(g.recovered_amount)}</td><td>{g.status}</td></tr>)}</tbody>
     </table></div>
    </details>
   </section>
   {warnings.length>0&&<section className="monthly-panel monthly-warnings">
     <h3>Pontos a conferir</h3>
     <ul>{warnings.map(w=><li key={w}>{w}</li>)}</ul>
   </section>}
   <p className="monthly-explanation monthly-disclaimer">
     Recebimentos de NF de convênio são consolidados por documento, não por paciente ou profissional.
     Glosas recuperadas não representam nova entrada de caixa. Este fechamento é uma fotografia financeira da competência, não um demonstrativo contábil/fiscal oficial.
   </p>
   <div className="monthly-closing-actions no-print">
    <button type="button" className="billing-primary" disabled={!canClose||busy}
     onClick={()=>setShowCloseDialog(true)}>Fechar competência</button>
    {preview?.closed?<span>Fechamento concluído — não pode ser substituído.</span>:
     month>=nowMonth?<span>Competência atual ou futura: disponível somente para prévia.</span>:
      data.issued_invoices.without_net_amount>0||data.cash.insurance_paid_invoices_without_net>0?
       <span>Corrija as NFs sem valor líquido antes de fechar.</span>:null}
   </div>
  </>}
  <section className="monthly-panel monthly-history no-print">
   <h3>Histórico de fechamentos desta entidade</h3>
   {!priorHistory.length?<p>Nenhuma competência encerrada para esta PJ/PF.</p>:
    <div className="monthly-history-list">
     {priorHistory.map(h=><button type="button" className="billing-secondary" key={h.id}
       onClick={()=>{setMonth(h.competence_month.slice(0,7));setShowCurrent(false);}}>
       {h.competence_month.slice(0,7)} · Fechado em {new Date(h.closed_at).toLocaleDateString("pt-BR")}
     </button>)}
    </div>}
  </section>
  {showCloseDialog&&valid&&<AppDialog label="Confirmar fechamento mensal" busy={busy}
   onClose={()=>setShowCloseDialog(false)}>
   <h2>Confirmar fechamento de {month}</h2>
   <p><strong>{selectedEntity?.trade_name||selectedEntity?.name}</strong></p>
   <p>Esta operação cria um retrato histórico imutável. Atualizações financeiras posteriores serão identificadas como divergências, sem reescrever este fechamento.</p>
   <label>Observações (opcional)
    <textarea value={notes} maxLength={2000} onChange={e=>setNotes(e.target.value)}/>
   </label>
   <div className="billing-modal-actions">
    <button type="button" className="billing-secondary" disabled={busy} onClick={()=>setShowCloseDialog(false)}>Cancelar</button>
    <button type="button" className="billing-primary" disabled={busy} onClick={()=>void closeMonth()}>
     {busy?"Fechando…":"Confirmar fechamento"}</button>
   </div>
  </AppDialog>}
 </section>;
}
