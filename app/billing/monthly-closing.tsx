"use client";
import {useCallback,useEffect,useMemo,useState} from "react";
import AppDialog from "@/components/app-dialog";
import {PrintIcon} from "@/components/billing-icons";
import {formatBRL} from "@/lib/money";
import {monthlyInvoiceStatus} from "@/lib/monthly-invoice-status";
import {monthlyCash,canCloseMonthlySnapshot} from "@/lib/monthly-closing-math";
import {formatDateBR} from "@/lib/date-format";
import "./monthly-closing.css";

type Entity={id:string;name:string;trade_name:string|null;tax_id:string;person_type:string;active:boolean};
type History={id:string;billing_entity_id:string;competence_month:string;closed_at:string;closed_by:number;notes:string|null};
type Professional={professional_id:string;professional_name:string;charges:number;attendances:number;
 private_charges:number;insurance_charges:number;pending_charges_now:number;attributed_invoice_items:number};
type Invoice={id:string;invoice_number:string;payer:string|null;issue_date:string|null;paid_at:string|null;
 recipient_type:string;total_amount:number|null;net_amount:number|null;
 status?:"ACTIVE"|"CANCELLED"|"REPLACED";
 replaced_by_invoice_id?:string|null;replacement_invoice_number?:string|null};
type DirectPayment={id:string;attendance_id:string;professional_id:string;professional_name:string;
 paid_at:string;received_amount:number|null;billing_method:string};
type Expense={id:string;description:string;category:string;competence_date:string;paid_at:string|null;
 amount:number;status:string;supplier:string};
type Denial={id:string;billing_record_id:string;denial_kind:string;denied_on:string;
 denied_amount:number;recovered_amount:number;status:string;reason:string};
type ProfessionalAttendance={billing_record_id:string;professional_id:string;professional_name:string;
 patient_name:string;procedure:string;service_date:string;payer_name:string;billing_method:string;payment_status:string};
type ProfessionalInvoiceLink={professional_id:string;invoice_id:string;invoice_number:string};
type Snapshot={
 entity:Entity;competence:string;period_start:string;period_end_exclusive:string;
 production:{attendances:number;charges:number;professionals:number;private_charges:number;
  insurance_charges:number;pending_charges_now:number;unpriced_charges:number};
 professionals:Professional[];
 professional_attendances?:ProfessionalAttendance[];
 professional_invoice_rows?:ProfessionalInvoiceLink[];
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
type ClosingEvent={version:number;id:string;date:string;actor_id:number;notes:string|null;event_type:"CLOSED"|"UNLOCKED"};
type Preview={current:Snapshot;closed:boolean;unlocked?:boolean;history?:ClosingEvent[];closing:Closing|null};
const date=(v:string|null|undefined)=>v?formatDateBR(v.slice(0,10)):"—";
const cash=(n:number|null|undefined)=>formatBRL(n??0);
const previousMonth=()=>{
 const now=new Date();
 const prior=new Date(now.getFullYear(),now.getMonth()-1,1);
 return prior.getFullYear()+"-"+String(prior.getMonth()+1).padStart(2,"0");
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
 const [showUnlockDialog,setShowUnlockDialog]=useState(false);
 const [unlockPassword,setUnlockPassword]=useState("");
 const [unlockReason,setUnlockReason]=useState("");
 const [unlockError,setUnlockError]=useState("");
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
 const summary=data?monthlyCash(data.cash,data.expenses):null;
 const totalCash=summary?.revenue||0;
 const netCash=summary?.result||0;
 const selectedEntity=entities.find(e=>e.id===entity);
 const priorHistory=history.filter(h=>h.billing_entity_id===entity).sort((a,b)=>b.competence_month.localeCompare(a.competence_month));
 const now=new Date();
 const nowMonth=now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
 const canClose=valid&&!preview!.closed&&month<nowMonth&&!!data&&canCloseMonthlySnapshot(data);
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
 async function unlockMonth(){
  if(busy||!preview?.closed||!valid)return;
  setBusy(true);setUnlockError("");
  try{
   const response=await fetch("/api/billing/closing",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action:"UNLOCK",entity_id:entity,month,
      password:unlockPassword,reason:unlockReason})
   });
   const result=await response.json();
   if(!response.ok)throw Error(result.error||"Não foi possível desbloquear.");
   setUnlockPassword("");setUnlockReason("");setShowUnlockDialog(false);
   await Promise.all([reloadOptions(),loadPreview(entity,month)]);
   setNotice("Competência desbloqueada pelo Gerente Geral. O histórico anterior permanece salvo.");
  }catch(cause){setUnlockPassword("");
   setUnlockError(cause instanceof Error?cause.message:"Não foi possível validar a senha.");
  }finally{setBusy(false);}
 }
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
   setNotice("Competência bloqueada. Só a senha do Gerente Geral permite desbloqueá-la.");
  }catch(cause){setError(cause instanceof Error?cause.message:"Erro ao fechar competência.");}
  finally{setBusy(false);}
 }
 return <section className="monthly-closing" aria-label="Fechamento mensal por PJ/PF">
  <header className="monthly-heading no-print">
   <div><h1>Fechamento mensal por PJ/PF</h1>
    <p>Selecione a entidade recebedora e a competência. Produção, NFs, caixa e glosas usam datas diferentes e não duplicam recebimentos.</p>
   </div>
   <button type="button" className="billing-icon-action" disabled={!valid}
     aria-label="Imprimir / gerar PDF do fechamento"
     title="Imprimir / gerar PDF em nova guia"
     onClick={()=>{
      if(!valid)return;
      const params=new URLSearchParams({entity_id:entity,month,
       view:preview?.closed&&!showCurrent?"closed":"current"});
      window.open("/api/reports/monthly-closing?"+params.toString(),
       "_blank","noopener,noreferrer");
     }}><PrintIcon/></button>
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
    <strong>Competência bloqueada.</strong>
    {preview.closing?.changed_since_close?
      " Existem lançamentos posteriores que diferem do fechamento. O histórico está preservado.":
      " O fechamento está protegido; operações financeiras retroativas continuam permitidas."}
    <div className="monthly-view-actions">
     <button type="button" className="billing-secondary" onClick={()=>setShowCurrent(false)}
      aria-pressed={!showCurrent}>Ver fechamento original</button>
     <button type="button" className="billing-secondary" onClick={()=>setShowCurrent(true)}
      aria-pressed={showCurrent}>Comparar com dados atuais</button>
    </div>
   </div>}
   <div className="monthly-summary">
    <article><span>Atendimentos realizados</span><strong>{data.production.attendances}</strong>
      <small>{data.production.charges} cobranças · {data.production.pending_charges_now} sem baixa financeira</small></article>
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
    <h3>Atendimentos e notas fiscais por médico</h3>
    {data.professionals.map(p=>{
     const details=(data.professional_attendances||[]).filter(a=>a.professional_id===p.professional_id);
     const related=new Set((data.professional_invoice_rows||[])
       .filter(l=>l.professional_id===p.professional_id).map(l=>l.invoice_id));
     const invoices=[...data.invoices].filter(i=>related.has(i.id))
       .sort((a,b)=>a.invoice_number.localeCompare(b.invoice_number,"pt-BR",{numeric:true}));
     const byPayer=new Map<string,ProfessionalAttendance[]>();
     for(const a of details){
      const payer=a.billing_method==="PARTICULAR"?"Particular":a.payer_name||"Não informado";
      const group=byPayer.get(payer)||[];group.push(a);byPayer.set(payer,group);
     }
     return <div className="monthly-doctor-block" key={p.professional_id}>
      <h4>{p.professional_name}</h4>
      <p className="monthly-doctor-summary">{p.attendances} atendimento(s) · {p.charges} cobrança(s)
       · {p.private_charges} particular(es) · {p.insurance_charges} convênio(s)
       · {p.pending_charges_now} sem baixa financeira</p>
      {[...byPayer.entries()].sort((a,b)=>a[0].localeCompare(b[0],"pt-BR")).map(([payer,items])=>
       <div key={payer} className="monthly-payer-group">
        <h5>Atendimentos — {payer}</h5>
        <div className="monthly-scroll"><table className="billing-table">
         <thead><tr><th>Paciente</th><th>Procedimento</th><th>Data</th><th>Pagamento</th></tr></thead>
         <tbody>{items.sort((a,b)=>a.service_date.localeCompare(b.service_date)).map(a=>
          <tr key={a.billing_record_id}>
           <td>{a.patient_name}</td><td>{a.procedure}</td><td>{date(a.service_date)}</td>
           <td>{a.payment_status==="PAGO"?"Pago":"Pendente"}</td>
          </tr>)}</tbody>
        </table></div>
       </div>)}
      {invoices.length>0&&<div className="monthly-payer-group">
       <h5>Notas fiscais — {p.professional_name}</h5>
       <div className="monthly-scroll"><table className="billing-table">
        <thead><tr><th>NF</th><th>Pagador / Tomador</th><th>Emissão</th><th>Pagamento</th>
         <th>Bruto</th><th>Líquido</th><th>Tipo</th><th>Status</th></tr></thead>
        <tbody>{invoices.map(i=><tr key={i.id}
         className={i.status==="REPLACED"?"monthly-nf-replaced":
            i.status==="CANCELLED"?"monthly-nf-cancelled":""}>
         <td>{i.invoice_number}</td><td>{i.payer||"—"}</td><td>{date(i.issue_date)}</td>
         <td>{date(i.paid_at)}</td>
         <td>{i.total_amount==null?"Não informado":cash(i.total_amount)}</td>
         <td>{i.net_amount==null?"Não informado":cash(i.net_amount)}</td>
         <td>{i.recipient_type}</td><td>{monthlyInvoiceStatus(i,data.invoices)}</td>
        </tr>)}</tbody></table></div>
      </div>}
     </div>;
    })}
    {data.invoices.filter(i=>!(data.professional_invoice_rows||[])
      .some(l=>l.invoice_id===i.id)).length>0&&
     <div className="monthly-doctor-block">
      <h4>Notas fiscais sem vínculo individual identificado</h4>
      <div className="monthly-scroll"><table className="billing-table">
       <thead><tr><th>NF</th><th>Pagador / Tomador</th><th>Emissão</th><th>Pagamento</th>
        <th>Bruto</th><th>Líquido</th><th>Tipo</th><th>Status</th></tr></thead>
       <tbody>{data.invoices.filter(i=>!(data.professional_invoice_rows||[]).some(l=>l.invoice_id===i.id))
        .sort((a,b)=>a.invoice_number.localeCompare(b.invoice_number,"pt-BR",{numeric:true}))
        .map(i=><tr key={i.id}
         className={i.status==="REPLACED"?"monthly-nf-replaced":
            i.status==="CANCELLED"?"monthly-nf-cancelled":""}>
         <td>{i.invoice_number}</td><td>{i.payer||"—"}</td><td>{date(i.issue_date)}</td>
         <td>{date(i.paid_at)}</td><td>{i.total_amount==null?"Não informado":cash(i.total_amount)}</td>
         <td>{i.net_amount==null?"Não informado":cash(i.net_amount)}</td>
         <td>{i.recipient_type}</td><td>{monthlyInvoiceStatus(i,data.invoices)}</td>
        </tr>)}</tbody></table></div>
     </div>}
    {!data.professionals.length&&!data.invoices.length&&<p>Sem atendimentos ou NFs nesta competência.</p>}
   </section>
   <section className="monthly-panel">
    <h3>Entradas financeiras — data do pagamento</h3>
    <div className="monthly-pair">
     <p><strong>Recebimentos individuais:</strong> {cash(data.cash.direct_received)}</p>
     <p><strong>NFs de convênio recebidas:</strong> {cash(data.cash.insurance_invoice_received)}</p>
    </div>
    <details><summary>Consultar recebimentos individuais ({data.direct_payments.length})</summary>
     <div className="monthly-scroll"><table className="billing-table">
      <thead><tr><th>Profissional</th><th>Pagamento</th><th>Forma de cobrança</th><th>Valor recebido</th></tr></thead>
      <tbody>{data.direct_payments.map(p=><tr key={p.id}>
       <td>{p.professional_name}</td><td>{date(p.paid_at)}</td><td>{p.billing_method}</td>
       <td>{cash(p.received_amount)}</td></tr>)}</tbody></table></div>
    </details>
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
    {preview?.closed?
      <button type="button" className="billing-secondary" disabled={busy}
       onClick={()=>{setUnlockError("");setUnlockPassword("");setUnlockReason("");setShowUnlockDialog(true);}}>
       Desbloquear mês com senha do Gerente Geral
      </button>:
      <button type="button" className="billing-primary" disabled={!canClose||busy}
       onClick={()=>setShowCloseDialog(true)}>{preview?.unlocked?"Bloquear mês novamente":"Fechar e bloquear mês"}</button>}
    {preview?.closed?<span>Competência bloqueada para alterações no fechamento.</span>:
     month>=nowMonth?<span>Competência atual ou futura: disponível somente para prévia.</span>:
      data.issued_invoices.without_net_amount>0||data.cash.insurance_paid_invoices_without_net>0?
       <span>Corrija as NFs sem valor líquido antes de fechar.</span>:null}
   </div>
  </>}
  <section className="monthly-panel monthly-history no-print">
   <h3>Histórico de fechamentos desta entidade</h3>
   {preview?.history?.length?
    <details className="monthly-revision-log">
     <summary>Histórico de bloqueios e desbloqueios da competência ({preview.history.length})</summary>
     <ul>{preview.history.map(e=><li key={e.id}>
      <strong>{e.event_type==="CLOSED"?"Mês bloqueado":"Mês desbloqueado"}</strong>
      {" · "+new Date(e.date).toLocaleString("pt-BR")}
      {" · Usuário #"+e.actor_id}
      {e.notes?" · "+e.notes:""}
     </li>)}</ul>
    </details>:null}
   {!priorHistory.length?<p>Nenhuma competência encerrada para esta PJ/PF.</p>:
    <div className="monthly-history-list">
     {priorHistory.map(h=><button type="button" className="billing-secondary" key={h.id}
       onClick={()=>{setMonth(h.competence_month.slice(0,7));setShowCurrent(false);}}>
       {h.competence_month.slice(0,7)} · Fechado em {new Date(h.closed_at).toLocaleDateString("pt-BR")}
     </button>)}
    </div>}
  </section>
  {showUnlockDialog&&valid&&preview?.closed&&<AppDialog
    label="Desbloquear competência com senha do Gerente Geral" busy={busy}
    onClose={()=>{setShowUnlockDialog(false);setUnlockPassword("");setUnlockError("");}}>
    <h2>Desbloquear {month}</h2>
    <p><strong>{selectedEntity?.trade_name||selectedEntity?.name}</strong></p>
    <p>Desbloquear permite revisar e bloquear novamente o fechamento. As versões anteriores continuam registradas.
       Isso não altera nem impede pagamentos e glosas retroativos.</p>
    <form onSubmit={event=>{event.preventDefault();void unlockMonth();}}>
     <label>Senha atual do Gerente Geral
      <input type="password" autoComplete="current-password" required minLength={8} maxLength={128}
       value={unlockPassword} onChange={e=>setUnlockPassword(e.target.value)}/>
     </label>
     <label>Motivo do desbloqueio
      <textarea required minLength={5} maxLength={2000}
       value={unlockReason} onChange={e=>setUnlockReason(e.target.value)}
       placeholder="Ex.: conferir lançamentos retroativos"/>
     </label>
     {unlockError&&<p role="alert" className="billing-error">{unlockError}</p>}
     <div className="billing-modal-actions">
      <button type="button" className="billing-secondary" disabled={busy}
       onClick={()=>{setShowUnlockDialog(false);setUnlockPassword("");setUnlockError("");}}>Cancelar</button>
      <button type="submit" className="billing-primary"
       disabled={busy||unlockPassword.length<8||unlockReason.trim().length<5}>
       {busy?"Validando senha…":"Validar senha e desbloquear"}
      </button>
     </div>
    </form>
   </AppDialog>}
  {showCloseDialog&&valid&&<AppDialog label="Confirmar fechamento mensal" busy={busy}
   onClose={()=>setShowCloseDialog(false)}>
   <h2>Confirmar bloqueio de {month}</h2>
   <p><strong>{selectedEntity?.trade_name||selectedEntity?.name}</strong></p>
   <p>O fechamento ficará bloqueado. Para desbloqueá-lo será necessária a senha do Gerente Geral.
     O histórico anterior continuará preservado. Pagamentos, NFs e glosas retroativos não são bloqueados.</p>
   <label>Observações (opcional)
    <textarea value={notes} maxLength={2000} onChange={e=>setNotes(e.target.value)}/>
   </label>
   <div className="billing-modal-actions">
    <button type="button" className="billing-secondary" disabled={busy} onClick={()=>setShowCloseDialog(false)}>Cancelar</button>
    <button type="button" className="billing-primary" disabled={busy} onClick={()=>void closeMonth()}>
     {busy?"Bloqueando…":"Confirmar bloqueio"}</button>
   </div>
  </AppDialog>}
 </section>;
}
