"use client";
import {invoiceRows} from '@/lib/billing-row';
import {formatBRL as money} from '@/lib/money';
import {matchesRow,matchesInvoice,rowStatus,invoiceStatus,ROW_STATUSES,INVOICE_STATUSES} from '@/lib/billing-row';
import {PrintIcon,EyeIcon,DocumentIcon} from '@/components/billing-icons';
import {formatDateBR} from '@/lib/date-format';
import {useEffect,useState} from 'react';
import type {BillingData,Invoice} from '@/lib/billing-types';
import {individualReceived,type ReportScope} from '@/lib/billing-reports';
import {historicalInvoice,compareInvoiceNumbersDesc} from '@/lib/fiscal-document';
import AppDialog from '@/components/app-dialog';
type DoctorInvoiceFilters={entity:string;insurance:string;status:string;start:string;end:string;doctor:string};
export const visibleDoctorInvoices=(data:BillingData,filters:DoctorInvoiceFilters)=>data.invoices.filter(i=>historicalInvoice(i)&&matchesInvoice(i,data,filters)).sort(compareInvoiceNumbersDesc);
export const doctorInvoiceProcedure=(invoice:Invoice,data:BillingData)=>{
 const rows=invoiceRows(invoice,data);
 return invoice.shared||rows.length>1?'Diversos':rows[0]?.row.procedure||'—';
};
export const doctorInvoiceProcedureDate=(invoice:Invoice,data:BillingData)=>{
 const rows=invoiceRows(invoice,data);
 if(invoice.shared||rows.length>1&&new Set(rows.map(({row})=>row.date).filter(Boolean)).size>1)return 'Várias datas';
 const dates=[...new Set(rows.map(({row})=>row.date).filter(Boolean))];
 return dates.length===1?dates[0]:'—';
};
export const doctorInvoiceProof=(invoice:Invoice,data:BillingData)=>{
 const current=(data.attachments||[]).filter(attachment=>attachment.status==='READY'&&attachment.is_current&&!attachment.deactivated_at);
 const direct=!invoice.shared?current.find(attachment=>attachment.invoice_id===invoice.id):undefined;
 if(direct)return direct;
 const rows=invoiceRows(invoice,data);
 return rows.length===1&&rows[0].row.record?.id?current.find(attachment=>attachment.billing_record_id===rows[0].row.record?.id):undefined;
};
export const doctorInvoiceStatusClass=(value:string)=>'doctor-invoice-status '+(value==='Pago'?'paid':value==='Aguardando pagamento'?'pending':value==='Cancelada'?'cancelled':value==='Substituída'?'replaced':'neutral');
export default function DoctorBilling({invoiceOnly=false}:{invoiceOnly?:boolean}){
 const [entity,setEntity]=useState(''),[insurance,setInsurance]=useState(''),[status,setStatus]=useState('');
 const [data,setData]=useState<BillingData|null>(null),[error,setError]=useState(''),[tab,setTab]=useState(invoiceOnly?'invoices':'records'),[start,setStart]=useState(''),[end,setEnd]=useState(''),[invoice,setInvoice]=useState<Invoice|null>(null);
 useEffect(()=>{let active=true;fetch('/api/billing'+(invoiceOnly?'?view=invoices':''),{cache:'no-store'}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(j.error);if(active)setData(j)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[invoiceOnly]);
 if(!data)return <main className="billing-main"><p role={error?'alert':undefined}>{error||'Carregando…'}</p></main>;
 function preview(){const scope:ReportScope={kind:tab==='invoices'?'invoices':'filtered',doctor:data!.doctor_id||'',entity,start,end,insurance,status,issued_at:new Date().toISOString()};const params=new URLSearchParams();Object.entries(scope).forEach(([key,value])=>{if(value)params.set(key,String(value))});window.open('/api/reports/billing?'+params.toString(),'_blank','noopener,noreferrer');setError('')}
 const filters={entity,insurance,status,start,end,doctor:data.doctor_id||''};
 const rows=data.rows.filter(r=>matchesRow(r,filters));
 const invoices=visibleDoctorInvoices(data,filters);
 return <>{!invoiceOnly&&<div className="billing-subnav no-print">
    <details className="billing-mobile-menu">
      <summary aria-label="Selecionar consulta financeira">
        <span><small>FATURAMENTO</small><strong>{tab==='invoices'?'Relação de Notas Fiscais':'Atendimentos'}</strong></span>
        <span className="billing-mobile-menu-chevron" aria-hidden="true">⌄</span>
      </summary>
      <nav className="billing-mobile-menu-links" aria-label="Consultas financeiras no celular">
        <button type="button" aria-current={tab==='records'?'page':undefined} onClick={event=>{setTab('records');setStatus('');event.currentTarget.closest('details')?.removeAttribute('open')}}>Atendimentos</button>
        {data.services?.invoice_enabled&&<button type="button" aria-current={tab==='invoices'?'page':undefined} onClick={event=>{setTab('invoices');setStatus('');event.currentTarget.closest('details')?.removeAttribute('open')}}>Relação de Notas Fiscais</button>}
      </nav>
    </details>
    <nav className="billing-subnav-nav" aria-label="Consultas financeiras">
      <button aria-current={tab==='records'?'page':undefined} onClick={()=>{setTab('records');setStatus('')}}>Atendimentos</button>
      {data.services?.invoice_enabled&&<button aria-current={tab==='invoices'?'page':undefined} onClick={()=>{setTab('invoices');setStatus('')}}>Relação de Notas Fiscais</button>}
    </nav>
  </div>}<main className={'billing-main '+(tab==='invoices'?'doctor-invoice-main':'')}><div className="billing-filter-bar"><div className="billing-filters"><label>Empresa<select value={entity} onChange={e=>setEntity(e.target.value)}><option value="">Todas</option>{data.entities.map(e=><option key={e.id} value={e.id}>{e.trade_name||e.name}</option>)}</select></label><label>Convênio / Pagador<select value={insurance} onChange={e=>setInsurance(e.target.value)}><option value="">Todos</option>{data.payers.map(p=><option key={p}>{p}</option>)}</select></label><label>Status<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">Todos</option>{(tab==='invoices'?INVOICE_STATUSES:ROW_STATUSES).map(s=><option key={s}>{s}</option>)}</select></label><label>De<input type="date" value={start} onChange={e=>setStart(e.target.value)}/></label><label>Até<input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label></div><div className="billing-filter-action"><button className="billing-icon-action" aria-label="Imprimir / gerar relatório" title="Imprimir / gerar relatório" onClick={preview}><PrintIcon/></button></div></div>{error&&<p role="alert" className="billing-error">{error}</p>}<div className="billing-panel"><table className={'billing-table '+(tab==='invoices'?'doctor-invoice-table':'')}><thead>{tab==='records'?<tr><th>Paciente</th><th>Data</th><th>Procedimento</th><th>Convênio</th><th>NF</th><th>Valor recebido</th><th>Pagamento</th><th>Status</th></tr>:<tr><th>NF</th><th>Pagador</th><th>Procedimento</th><th>Data do procedimento</th><th>Emissão</th><th>Pagamento</th><th>Valor líquido</th><th>Status</th><th>Ações</th></tr>}</thead><tbody>{tab==='records'?rows.map(r=><tr key={r.attendance_id}><td>{r.patient}</td><td>{formatDateBR(r.date)}</td><td>{r.procedure}</td><td>{r.insurance||'Particular'}</td><td>{r.invoice?.invoice_number||r.record?.invoice_number||'—'}</td><td>{money(individualReceived(r))}</td><td>{formatDateBR(r.invoice?.paid_at||r.record?.paid_at)}</td><td>{rowStatus(r)}</td></tr>):invoices.map(i=>{const statusLabel=invoiceStatus(i),proof=doctorInvoiceProof(i,data),hasDetails=i.recipient_type==='CONVENIO',procedureDate=doctorInvoiceProcedureDate(i,data);return <tr key={i.id}><td>{i.invoice_number}</td><td>{i.payer}</td><td>{doctorInvoiceProcedure(i,data)}</td><td>{procedureDate==='Várias datas'?procedureDate:formatDateBR(procedureDate)}</td><td>{formatDateBR(i.issue_date)}</td><td>{i.paid_at?formatDateBR(i.paid_at):'Pendente'}</td><td>{i.shared?'NF compartilhada · total restrito':money(i.net_amount)}</td><td><span className={doctorInvoiceStatusClass(statusLabel)}>{statusLabel}</span></td><td>{hasDetails||proof?<span className="doctor-invoice-actions">{hasDetails&&<button className="billing-icon-action" title="Ver meus atendimentos" aria-label={'Ver meus atendimentos da NF '+i.invoice_number} onClick={()=>setInvoice(i)}><EyeIcon/></button>}{proof&&<a className="billing-icon-action" title="Visualizar comprovante" aria-label={'Visualizar comprovante da NF '+i.invoice_number} href={'/api/financial-attachments?id='+encodeURIComponent(proof.id)} target="_blank" rel="noopener noreferrer"><DocumentIcon/></a>}</span>:'—'}</td></tr>})}</tbody></table></div>{invoice&&<AppDialog label="Meus atendimentos da NF" onClose={()=>setInvoice(null)}><h2>NF {invoice.invoice_number}</h2><p>{invoice.payer} · Pagamento: {invoice.paid_at?formatDateBR(invoice.paid_at):'Pendente'}</p><table className="billing-table"><thead><tr><th>Paciente</th><th>Data</th><th>Procedimento</th><th>Valor individual</th></tr></thead><tbody>{invoiceRows(invoice,data).map(({row:r,amount})=><tr key={r.attendance_id}><td>{r.patient}</td><td>{formatDateBR(r.date)}</td><td>{r.procedure}</td><td>{money(amount)}</td></tr>)}</tbody></table><button className="billing-secondary" onClick={()=>setInvoice(null)}>Fechar</button></AppDialog>}</main></>;
}

