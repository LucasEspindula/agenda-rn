'use client';
import {useRef,useState} from 'react';
import type {FinancialAttachment} from '@/lib/billing-types';
import {notifyFinancialChange} from '@/lib/financial-events';
import {paymentProofAccept,uploadFinancialAttachment,removeFinancialAttachment} from '@/lib/financial-attachments-client';

function currentFor(all:FinancialAttachment[],invoiceId?:string,billingRecordId?:string){return all.filter(a=>a.status==='READY'&&a.is_current&&(invoiceId?a.invoice_id===invoiceId:a.billing_record_id===billingRecordId));}
function historicalFor(all:FinancialAttachment[],invoiceId?:string,billingRecordId?:string){return all.filter(a=>a.status==='READY'&&!a.is_current&&(invoiceId?a.invoice_id===invoiceId:a.billing_record_id===billingRecordId));}
export function paymentProofLabel(all:FinancialAttachment[]|undefined,invoiceId?:string,billingRecordId?:string){return currentFor(all||[],invoiceId,billingRecordId).length?'Pago · Comprovante anexado':'Pago · Sem comprovante';}
type Props={attachments?:FinancialAttachment[];invoiceId?:string;billingRecordId?:string;readOnly?:boolean;onChanged?:()=>void;pendingFile?:File|null;onPendingFileChange?:(file:File|null)=>void};
export default function PaymentProofs({attachments,invoiceId,billingRecordId,readOnly=false,onChanged,pendingFile,onPendingFileChange}:Props){
 const input=useRef<HTMLInputElement>(null),[replaces,setReplaces]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const all=attachments||[],current=currentFor(all,invoiceId,billingRecordId),history=historicalFor(all,invoiceId,billingRecordId),ready=Boolean(invoiceId||billingRecordId),canPrepare=!readOnly&&(ready||!!onPendingFileChange);
 async function send(file:File){
  if(!ready||busy)return;setBusy(true);setError('');
  try{await uploadFinancialAttachment(file,{invoiceId,billingRecordId,replacesId:replaces});setReplaces(null);notifyFinancialChange();onChanged?.();}
  catch(e){setError(e instanceof Error?e.message:'O pagamento foi mantido, mas o comprovante não foi enviado. Tente novamente.');}
  finally{setBusy(false);if(input.current)input.current.value='';}
 }
 async function removeProof(id:string){
  if(busy||readOnly||!window.confirm('Excluir este comprovante? O pagamento será mantido e a exclusão ficará registrada no histórico.'))return;
  setBusy(true);setError('');
  try{
   await removeFinancialAttachment(id);
   notifyFinancialChange();onChanged?.();
  }catch(e){
   setError(e instanceof Error?e.message:'Não foi possível excluir o comprovante.');
  }finally{setBusy(false)}
 }
 const choose=(id?:string)=>{setReplaces(id||null);input.current?.click();};
 const selected=(file:File)=>{if(ready)void send(file);else onPendingFileChange?.(file);};
 return <section className="payment-proofs"><div className="payment-proofs-head"><div><h3>Comprovante de pagamento</h3><p>{current.length?'Comprovante anexado.':'Pago · Sem comprovante'}</p></div>{canPrepare&&<button type="button" className="billing-secondary" disabled={busy} onClick={()=>choose()} title="Anexar comprovante de pagamento">+ Anexar comprovante</button>}</div>
 <input ref={input} className="sr-only" aria-label="Selecionar comprovante de pagamento" type="file" accept={paymentProofAccept} onChange={e=>{const file=e.target.files?.[0];if(file)selected(file);}}/>
 <p className="billing-origin">PDF, JPG ou PNG · até 10 MB</p>
 {!ready&&pendingFile&&<p className="billing-origin">✓ {pendingFile.name}<br/>Será enviado após salvar o pagamento. <button type="button" className="billing-link-button" onClick={()=>onPendingFileChange?.(null)}>Remover</button></p>}
 {current.map(a=><div className="payment-proof-file" key={a.id}><span aria-hidden="true">✓</span><strong>{a.original_filename}</strong><div><a href={'/api/financial-attachments?id='+encodeURIComponent(a.id)} target="_blank" rel="noreferrer">Visualizar</a>{!readOnly&&<><button type="button" onClick={()=>choose(a.id)} disabled={busy}>Substituir</button><button type="button" className="payment-proof-delete" aria-label={'Excluir comprovante '+a.original_filename} onClick={()=>void removeProof(a.id)} disabled={busy}>Excluir</button></>}</div></div>)}
 {current.length>0&&!readOnly&&<button type="button" className="billing-link-button" disabled={busy} onClick={()=>choose()}>+ Adicionar comprovante</button>}
 {history.length>0&&<details className="payment-proof-history"><summary>Histórico de comprovantes ({history.length})</summary>{history.map(a=><div className="payment-proof-file historical" key={a.id}><span aria-hidden="true">↳</span><strong>{a.original_filename}</strong><small>{a.deactivation_reason==='PAYMENT_REVERSED'?'Pagamento revertido':a.deactivation_reason==='REMOVED_BY_USER'?'Excluído':'Substituído'}</small><a href={'/api/financial-attachments?id='+encodeURIComponent(a.id)} target="_blank" rel="noreferrer">Visualizar</a></div>)}</details>}
 {error&&<p role="alert" className="billing-error">{error}</p>}</section>;
}
