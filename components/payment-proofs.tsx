'use client';
import {useRef,useState} from 'react';
import type {FinancialAttachment} from '@/lib/billing-types';
import {notifyFinancialChange} from '@/lib/financial-events';

const ACCEPT='application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png';
function currentFor(all:FinancialAttachment[],invoiceId?:string,billingRecordId?:string){return all.filter(a=>a.status==='READY'&&a.is_current&&(invoiceId?a.invoice_id===invoiceId:a.billing_record_id===billingRecordId));}
function historicalFor(all:FinancialAttachment[],invoiceId?:string,billingRecordId?:string){return all.filter(a=>a.status==='READY'&&!a.is_current&&(invoiceId?a.invoice_id===invoiceId:a.billing_record_id===billingRecordId));}
export function paymentProofLabel(all:FinancialAttachment[]|undefined,invoiceId?:string,billingRecordId?:string){return currentFor(all||[],invoiceId,billingRecordId).length?'Pago · Comprovante anexado':'Pago · Sem comprovante';}
export default function PaymentProofs({attachments,invoiceId,billingRecordId,readOnly=false,onChanged}:{attachments?:FinancialAttachment[];invoiceId?:string;billingRecordId?:string;readOnly?:boolean;onChanged?:()=>void}){
 const input=useRef<HTMLInputElement>(null),[replaces,setReplaces]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const all=attachments||[],current=currentFor(all,invoiceId,billingRecordId),history=historicalFor(all,invoiceId,billingRecordId),ready=Boolean(invoiceId||billingRecordId);
 async function send(file:File){
  if(!ready||busy)return;setBusy(true);setError('');
  try{
   const started=await fetch('/api/financial-attachments',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({invoiceId,billingRecordId,name:file.name,mimeType:file.type,size:file.size,replacesId:replaces})}),start=await started.json();
   if(!started.ok)throw Error(start.error);
   const uploaded=await fetch(start.url,{method:'PUT',headers:{'content-type':file.type},body:file});
   if(!uploaded.ok)throw Error('O pagamento foi mantido, mas o comprovante não foi enviado. Tente novamente.');
   const finished=await fetch('/api/financial-attachments',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({id:start.id})}),done=await finished.json();
   if(!finished.ok)throw Error(done.error||'O pagamento foi mantido, mas o comprovante não foi enviado. Tente novamente.');
   setReplaces(null);notifyFinancialChange();onChanged?.();
  }catch(e){setError(e instanceof Error?e.message:'O pagamento foi mantido, mas o comprovante não foi enviado. Tente novamente.');}
  finally{setBusy(false);if(input.current)input.current.value='';}
 }
 const choose=(id?:string)=>{setReplaces(id||null);input.current?.click();};
 return <section className="payment-proofs"><div className="payment-proofs-head"><div><h3>Comprovante de pagamento</h3><p>{current.length?'Comprovante anexado.':'Pago · Sem comprovante'}</p></div>{!readOnly&&<button type="button" className="billing-secondary" disabled={!ready||busy} onClick={()=>choose()} title="Anexar comprovante de pagamento">+ Anexar comprovante</button>}</div>
 {!ready&&!readOnly&&<p className="billing-origin">Salve o pagamento para anexar o comprovante.</p>}
 <input ref={input} className="sr-only" aria-label="Selecionar comprovante de pagamento" type="file" accept={ACCEPT} onChange={e=>{const file=e.target.files?.[0];if(file)void send(file);}}/>
 <p className="billing-origin">PDF, JPG ou PNG · até 10 MB</p>
 {current.map(a=><div className="payment-proof-file" key={a.id}><span aria-hidden="true">✓</span><strong>{a.original_filename}</strong><div><a href={'/api/financial-attachments?id='+encodeURIComponent(a.id)} target="_blank" rel="noreferrer">Visualizar</a>{!readOnly&&<button type="button" onClick={()=>choose(a.id)} disabled={busy}>Substituir</button>}</div></div>)}
 {current.length>0&&!readOnly&&<button type="button" className="billing-link-button" disabled={busy} onClick={()=>choose()}>+ Adicionar comprovante</button>}
 {history.length>0&&<details className="payment-proof-history"><summary>Histórico de comprovantes ({history.length})</summary>{history.map(a=><div className="payment-proof-file historical" key={a.id}><span aria-hidden="true">↳</span><strong>{a.original_filename}</strong><small>{a.deactivation_reason==='PAYMENT_REVERSED'?'Pagamento revertido':'Substituído'}</small><a href={'/api/financial-attachments?id='+encodeURIComponent(a.id)} target="_blank" rel="noreferrer">Visualizar</a></div>)}</details>}
 {error&&<p role="alert" className="billing-error">{error}</p>}</section>;
}
