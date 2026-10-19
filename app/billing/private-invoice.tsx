'use client';
import {notifyFinancialChange} from '@/lib/financial-events';
import {useEffect,useState} from 'react';
import type {BillingData,Invoice,InvoiceRequest} from '@/lib/billing-types';
import AppDialog from '@/components/app-dialog';
import {PaymentPartsReadOnly} from '@/components/payment-parts';
import PaymentProofs from '@/components/payment-proofs';
import MoneyInput from '@/components/money-input';
import {formatCPF} from '@/lib/cpf';
import {parseBRL} from '@/lib/money';
import {formatDateBR} from '@/lib/date-format';
import {isInvoiceFromEarlierMonth} from '@/lib/invoice-prior-month';
export default function PrivateInvoice({data,initial,onClose,onSaved,onInsurance,replacement}:{replacement?:{invoice:Invoice;reason:string}|null;data:BillingData;initial:InvoiceRequest|Invoice|null;onClose:()=>void;onSaved:()=>void;onInsurance:()=>void}){
 const invoice=initial&&'recipient_type' in initial?initial as Invoice:null;
 const initialRequest=initial&&'taker_name' in initial?initial as InvoiceRequest:data.requests?.find(r=>r.invoice_id===invoice?.id);
 const [managerPassword,setManagerPassword]=useState('');
 const [managerId,setManagerId]=useState('');
 const [managers,setManagers]=useState<{id:number;name:string}[]>([]);
 useEffect(()=>{
  if(!replacement||!isInvoiceFromEarlierMonth(replacement.invoice.issue_date))return;
  let live=true;
  void fetch('/api/billing/approvers',{cache:'no-store'}).then(r=>r.json())
   .then(data=>{if(live)setManagers(data.managers||[])})
   .catch(()=>{});
  return ()=>{live=false};
 },[replacement]);
 const [requestId,setRequestId]=useState(initialRequest?.id||''),[number,setNumber]=useState(replacement?'':invoice?.invoice_number||''),[issue,setIssue]=useState(invoice?.issue_date?.slice(0,10)||new Date().toISOString().slice(0,10)),[gross,setGross]=useState<string|number|null>(invoice?.total_amount??initialRequest?.received_amount_snapshot??''),[net,setNet]=useState<string|number|null>(invoice?.net_amount??initialRequest?.received_amount_snapshot??''),[notes,setNotes]=useState(invoice?.notes||''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=data.requests?.find(r=>r.id===requestId);
 return <AppDialog label="Registrar NF Particular" onClose={onClose} busy={busy}><form onSubmit={async e=>{e.preventDefault();if(busy||!request)return;setBusy(true);setError('');try{const response=await fetch('/api/billing',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(replacement?{kind:'replace_invoice',manager_password:managerPassword,manager_user_id:managerId?Number(managerId):undefined,data:{id:replacement.invoice.id,updated_at:replacement.invoice.updated_at,reason:replacement.reason,replacement:{...invoice,recipient_type:'PARTICULAR',request_id:request.id,attendance_ids:[request.attendance_id],billing_entity_id:request.billing_entity_id,invoice_number:number,issue_date:issue,total_amount:parseBRL(gross),net_amount:parseBRL(net),notes}}}:{kind:'invoice',data:{...invoice,recipient_type:'PARTICULAR',request_id:request.id,attendance_ids:[request.attendance_id],billing_entity_id:request.billing_entity_id,invoice_number:number,issue_date:issue,total_amount:parseBRL(gross),net_amount:parseBRL(net),notes}})});const result=await response.json();if(!response.ok)throw Error(result.error);notifyFinancialChange();onSaved();onClose();}catch(e){setError(e instanceof Error?e.message:'Não foi possível registrar a NF.')}finally{setBusy(false)}}}>
 <h2>{invoice?'Nota Fiscal Particular':'Registrar NF'}</h2><div className="billing-form-grid"><label>Tipo de tomador<select value="PARTICULAR" disabled={!!initial} onChange={e=>{if(e.target.value==='CONVENIO')onInsurance()}}><option value="PARTICULAR">Particular</option><option value="CONVENIO">Convênio</option></select></label>
 {!initial&&<label>Solicitação de NF<select required value={requestId} onChange={e=>{setRequestId(e.target.value);const r=data.requests?.find(r=>r.id===e.target.value);setGross(r?.received_amount_snapshot??'');setNet(r?.received_amount_snapshot??'')}}><option value="">Selecione o atendimento</option>{data.requests?.filter(r=>r.status==='PENDING').map(r=><option key={r.id} value={r.id}>{r.patient_name_snapshot}{r.taker_kind==='OTHER'?` · Tomador: ${r.taker_name}`:''} · {formatDateBR(r.attendance_date_snapshot)}</option>)}</select></label>}
 {request&&<><label>Empresa emissora<input readOnly value={request.entity_name_snapshot}/></label><label>Nome do tomador<input readOnly value={request.taker_name}/></label><label>CPF<input readOnly value={formatCPF(request.taker_tax_id)}/></label><label>Endereço<input readOnly value={request.taker_address||'Não informado'}/></label><label>Data do pagamento<input readOnly type="date" value={request.paid_at_snapshot.slice(0,10)}/></label></>}
 <label>Número da NF<input required value={number} onChange={e=>setNumber(e.target.value)}/></label><label>Data de emissão<input required type="date" value={issue} onChange={e=>setIssue(e.target.value)}/></label><label>Valor bruto<MoneyInput value={gross} onChange={setGross}/></label><label>Valor líquido<MoneyInput value={net} onChange={setNet}/></label></div>
 {request&&<><h3>Atendimento vinculado</h3><p>{request.patient_name_snapshot} · {request.procedure_snapshot} · {formatDateBR(request.attendance_date_snapshot)}<br/>{request.doctor_name_snapshot}</p><p>Um atendimento por NF particular. O recebimento permanece registrado no atendimento.</p>{request.notes&&<p><strong>Observação da solicitação:</strong> {request.notes}</p>}</>}
 {invoice&&request&&<><PaymentPartsReadOnly value={(data.payment_parts||[]).filter(p=>p.billing_record_id===request.billing_record_id)}/><PaymentProofs attachments={data.attachments} billingRecordId={request.billing_record_id} readOnly/></>}
 <label>Observação fiscal<textarea value={notes} onChange={e=>setNotes(e.target.value)}/></label>
 {replacement&&isInvoiceFromEarlierMonth(replacement.invoice.issue_date)&&
 <label>Gerente Geral que autoriza<select value={managerId} onChange={e=>setManagerId(e.target.value)}>
  <option value="">Meu usuário de gerência</option>
  {managers.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
 </select></label>}
 {replacement&&isInvoiceFromEarlierMonth(replacement.invoice.issue_date)&&
 <label>Senha atual do Gerente Geral — NF de mês anterior
 <input type="password" required minLength={8} maxLength={128}
  autoComplete="current-password" value={managerPassword} onChange={e=>setManagerPassword(e.target.value)}/></label>}
 {error&&<p role="alert" className="billing-error">{error}</p>}<div className="billing-modal-actions"><button type="button" disabled={busy} onClick={onClose} className="billing-secondary">Fechar</button><button type="submit" className="billing-primary" disabled={busy||!request}>{busy?'Salvando…':'Salvar NF'}</button></div>
 </form></AppDialog>;
}
