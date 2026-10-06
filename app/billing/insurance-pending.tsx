"use client";
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type {BillingData,BillingRow} from '@/lib/billing-types';
import {companyLabel,isInsurancePending,rowEntityId} from '@/lib/billing-row';
import {groupPendingRows,pendingAction,pendingAge,pendingStatus,pendingSummary,pendingToday} from '@/lib/insurance-pending';
import {NavIcon,PrintIcon,WalletIcon} from '@/components/billing-icons';
import './insurance-pending.css';

const date=(value:string)=>value.slice(0,10).split('-').reverse().join('/');
const taxLabel=(value:string)=>value.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,'$1.$2.$3/$4-$5').replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/,'$1.$2.$3-$4');
const ageLabel=(age:number)=>`${age} ${age===1?'dia':'dias'}`;
function PendingTable({data,rows,today,onResolve}:{data:BillingData;rows:BillingRow[];today:string;onResolve?:(row:BillingRow)=>void}){
 return <div className="pending-table-scroll"><table className="billing-table pending-table"><thead><tr><th>Paciente / origem</th><th>Data</th><th>Procedimento</th><th>Médico</th><th>Empresa</th><th>NF / lote</th><th>Status</th><th>Em aberto</th>{onResolve&&<th>Ação</th>}</tr></thead><tbody>{rows.map(row=>{const action=pendingAction(row,data);return <tr key={row.attendance_id}><td><strong>{row.patient}</strong><small className="billing-origin">{row.origin==='AGENDA'?'Agenda':row.origin==='FISCAL_MANUAL'?'Manual fiscal':'Manual'}</small></td><td>{date(row.date)}</td><td>{row.procedure||'—'}</td><td>{data.doctors.find(d=>d.id===row.doctor_id)?.name||'Não informado'}</td><td>{rowEntityId(row)?companyLabel(data,rowEntityId(row)):'Não definida'}</td><td>{action.kind==='invoice'?row.invoice?.invoice_number:action.kind==='payment'?'Não gerenciada':'—'}</td><td><span className="billing-badge pending">{pendingStatus(row,data)}</span></td><td className={pendingAge(row.date,today)>60?'pending-overdue':''}>{ageLabel(pendingAge(row.date,today))}</td>{onResolve&&<td><button className="billing-secondary pending-resolve" title={action.label+' · '+row.patient} aria-label={action.label+' · '+row.patient} onClick={()=>onResolve(row)}>{action.kind==='payment'?<WalletIcon/>:<NavIcon kind="invoices"/>}{action.label}</button></td>}</tr>})}</tbody></table></div>;
}

function PendingPrint({data,rows,today,onClose}:{data:BillingData;rows:BillingRow[];today:string;onClose:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close()},[]);
 return createPortal(<dialog ref={ref} className="insurance-pending-print" aria-label="Impressão de pendências de convênio" onCancel={e=>{e.preventDefault();onClose()}}><div className="pending-print-toolbar no-print"><button autoFocus className="billing-secondary" onClick={onClose}>Voltar às pendências</button><button className="billing-primary" onClick={()=>window.print()}><PrintIcon/> Imprimir</button></div><h1>Pendências de Convênio</h1><p>{rows.length} atendimento(s) · Emissão: {date(today)}</p>{groupPendingRows(data,rows,today).map(company=><section key={company.id}><h2>{company.name}</h2>{company.payers.map(payer=><section key={payer.key}><h3>{payer.name} · {payer.total} pendência(s)</h3><PendingTable data={data} rows={payer.rows} today={today}/></section>)}</section>)}{!rows.length&&<p>Nenhuma pendência nos filtros selecionados.</p>}</dialog>,document.body);
}

function Chevron({open}:{open:boolean}){return <svg className={'pending-chevron'+(open?' is-open':'')} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>}

export default function InsurancePending({data,rows,onResolve,printAll,onClosePrint,filters}:{filters:ReactNode;data:BillingData;rows:BillingRow[];onResolve:(row:BillingRow)=>void;printAll:boolean;onClosePrint:()=>void}){
 const [expanded,setExpanded]=useState<Record<string,boolean>>({});
 const [printRows,setPrintRows]=useState<BillingRow[]|null>(null);
 const today=pendingToday(),summary=pendingSummary(rows,today),groups=groupPendingRows(data,rows,today);
 // Globally empty companies stay distinct from companies hidden by the filters.
 const occupied=new Set(data.rows.filter(isInsurancePending).map(rowEntityId));
 const emptyCompanies=data.entities.filter(e=>!occupied.has(e.id)).sort((a,b)=>(a.trade_name||a.name).localeCompare(b.trade_name||b.name,'pt-BR'));
 const toggle=(key:string)=>setExpanded(values=>({...values,[key]:!values[key]}));
 return <section className="insurance-pending" aria-label="Fila de pendências de convênio">
  <header className="pending-page-heading page-description"><p>Atendimentos realizados que ainda aguardam resolução financeira pelo convênio.</p></header>
  <div className="pending-summary" aria-label="Resumo dos filtros">
   <article className="pending-total"><span>Total pendente</span><strong>{summary.total}</strong><small>atendimentos aguardando resolução</small></article>
   <article className="pending-oldest-card"><span>Mais antiga</span><strong>{summary.total?ageLabel(summary.oldest):'—'}</strong><small>{groups[0]?`${groups[0].payers[0].name} · ${groups[0].name}`:'Nenhuma pendência nos filtros'}</small></article>
   <article><span>Empresas com pendência</span><strong>{summary.companies}</strong><small>de {data.entities.length} empresas recebedoras</small></article>
   <article><span>Acima de 60 dias</span><strong>{summary.over60}</strong><small>atenção prioritária</small></article>
  </div>
  {filters}
  <div className="pending-section-heading"><h2>Visão por empresa recebedora</h2><p>Empresas com pendência mais antiga aparecem primeiro.</p></div>
  <div className="pending-groups">{groups.map(company=>{
   const key='company:'+company.id,opened=!!expanded[key],contentId='pending-company-'+(company.id||'unassigned'),entity=data.entities.find(e=>e.id===company.id);
   return <section className="pending-company" key={company.id}>
    <h3><button className="pending-company-toggle" aria-expanded={opened} aria-controls={contentId} onClick={()=>toggle(key)}>
     <span className="pending-company-identity"><strong className="pending-company-name">{company.name}</strong>{entity?.tax_id&&<small>{entity.person_type==='PF'?'CPF':'CNPJ'} {taxLabel(entity.tax_id)}</small>}</span>
     <span className="pending-company-metrics"><span className="pending-metric"><b>{company.total}</b><small>Pendentes</small></span>{['0–30d','31–60d','61–90d','+90d'].map((label,i)=><span className={'pending-metric'+(i===2&&company.buckets[i]?' is-warning':i===3&&company.buckets[i]?' is-danger':'')} key={label}><b>{company.buckets[i]}</b><small>{label}</small></span>)}<span className={'pending-metric pending-metric-oldest'+(company.oldest>90?' is-danger':company.oldest>60?' is-warning':'')}><b>{ageLabel(company.oldest)}</b><small>Mais antiga</small></span></span>
     <Chevron open={opened}/>
    </button></h3>
    <div id={contentId} hidden={!opened} className="pending-company-content">{company.payers.map((payer,index)=>{
     const payerId=key+':payer:'+payer.key,isOpen=!!expanded[payerId],tableId=contentId+'-payer-'+index;
     return <section className="pending-payer" key={payer.key}><div className="pending-payer-header"><h4><button aria-expanded={isOpen} aria-controls={tableId} onClick={()=>toggle(payerId)}><strong>{payer.name}</strong><span className="pending-payer-count">{payer.total} {payer.total===1?'pendente':'pendentes'}</span><span className="pending-payer-oldest">Mais antiga: <b>{ageLabel(payer.oldest)}</b></span><Chevron open={isOpen}/></button></h4><button className="billing-icon-action" title={'Imprimir '+payer.name+' · '+company.name} aria-label={'Imprimir '+payer.name+' · '+company.name} onClick={()=>setPrintRows(payer.rows)}><PrintIcon/></button></div><div id={tableId} hidden={!isOpen} className="pending-payer-content"><div className="pending-attendances-heading">Atendimentos pendentes · {payer.name}</div><PendingTable data={data} rows={payer.rows} today={today} onResolve={onResolve}/></div></section>
    })}</div>
   </section>
  })}</div>
  {!groups.length&&<p className="billing-empty">Nenhuma pendência nos filtros selecionados.</p>}
  <details className="pending-empty-companies"><summary>Sem pendências ({emptyCompanies.length})</summary><ul>{emptyCompanies.map(e=><li key={e.id}>{e.trade_name||e.name}{!e.active&&<small> · Inativa</small>}</li>)}</ul>{!emptyCompanies.length&&<p>Todas as entidades possuem pendências.</p>}</details>
  {(printAll||printRows)&&<PendingPrint data={data} rows={printAll?rows:printRows!} today={today} onClose={()=>{setPrintRows(null);onClosePrint()}}/>}
 </section>;
}
