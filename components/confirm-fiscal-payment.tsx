'use client';
import PaymentParts from './payment-parts';
import {validPaymentParts,type PaymentPart} from '@/lib/fiscal-money';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AppDialog from './app-dialog';
import './confirm-fiscal-payment.css';
import {formatBRL} from '@/lib/money';
import {formatCPF,normalizeCPF,validCPF} from '@/lib/cpf';

export type FiscalRecipient={taker_kind:'PATIENT'|'OTHER';taker_name:string;taker_tax_id:string;taker_address:string;notes:string;payment_parts?:PaymentPart[];no_invoice?:boolean};
export type FiscalPatient={id:string;name:string;cpf?:string;address?:string};
type Context={patient:FiscalPatient;amount:number|null;paidAt:string;noInvoice?:boolean};

export function patientRecipient(patient:FiscalPatient):FiscalRecipient{
 return {taker_kind:'PATIENT',taker_name:patient.name,taker_tax_id:patient.cpf||'',
  taker_address:patient.address||'',notes:''};
}

function Confirmation({context,done}:{context:Context;done:(value:FiscalRecipient|null)=>void}){
 const [parts,setParts]=useState<PaymentPart[]>([]);
 const [noInvoice,setNoInvoice]=useState(!!context.noInvoice);
 const [value,setValue]=useState<FiscalRecipient>(()=>patientRecipient(context.patient));
 const [error,setError]=useState('');
 const set=(key:keyof FiscalRecipient,text:string)=>setValue(v=>({...v,[key]:text}));

 const submit=(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();
  if(!noInvoice&&(!value.taker_name.trim()||!validCPF(value.taker_tax_id))){
   setError('Informe o nome e um CPF válido do tomador.');return;
  }
  if(!noInvoice&&value.taker_kind==='PATIENT'&&context.patient.cpf&&
     normalizeCPF(context.patient.cpf)!==normalizeCPF(value.taker_tax_id)){
   setError('CPF diferente do cadastro. Corrija o paciente ou selecione Outra pessoa.');return;
  }
  if(!validPaymentParts(parts,context.amount??0)){
   setError('As formas de pagamento devem somar o valor recebido.');return;
  }
  done({...value,payment_parts:parts,no_invoice:noInvoice,
   taker_name:value.taker_name.trim(),taker_tax_id:noInvoice?'':normalizeCPF(value.taker_tax_id)});
 };

 return <AppDialog label="Confirmar pagamento e solicitar NF" onClose={()=>done(null)}
   className="fiscal-confirmation-dialog">
  <form className="fiscal-confirmation" data-layout-version="receipt-20261021-v2" onSubmit={submit}>
   <h2>Confirmar recebimento</h2>

   <section className="fiscal-card" aria-labelledby="fiscal-payment-title">
    <h3 id="fiscal-payment-title">Pagamento</h3>
    <div className="fiscal-payment-summary">
     <div><span>Valor recebido</span><strong>{formatBRL(context.amount)}</strong></div>
     <div><span>Data do pagamento</span><strong>{context.paidAt.split('-').reverse().join('/')}</strong></div>
    </div>

    <PaymentParts value={parts} onChange={setParts} amount={context.amount??0}/>

    <label className="fiscal-radio fiscal-no-invoice">
     <input type="checkbox" checked={noInvoice}
      style={{width:18,height:18,minWidth:18,minHeight:18,flex:'0 0 18px',
       padding:0,margin:0,boxSizing:'border-box'}}
      onChange={e=>{setNoInvoice(e.target.checked);setError('');}}/>
     <span>Sem Nota Fiscal (S/N)</span>
    </label>
   </section>

   {!noInvoice&&<section className="fiscal-card" aria-labelledby="fiscal-nf-title">
    <h3 id="fiscal-nf-title">Dados para emissão da NF</h3>
    <fieldset className="fiscal-recipient-kind">
     <legend>NF será emitida em nome de:</legend>
     <div className="fiscal-recipient-options">
      {([['PATIENT','Próprio paciente'],['OTHER','Outra pessoa']] as const).map(([kind,label])=>
       <label key={kind} className="fiscal-radio">
        <input type="radio" name="taker_kind" checked={value.taker_kind===kind}
         style={{width:18,height:18,minWidth:18,minHeight:18,flex:'0 0 18px',
          padding:0,margin:0,boxSizing:'border-box'}}
         onChange={()=>{
          setError('');
          setValue(kind==='PATIENT'?patientRecipient(context.patient):
           {taker_kind:'OTHER',taker_name:'',taker_tax_id:'',taker_address:'',notes:''});
         }}/>
        <span>{label}</span>
       </label>
      )}
     </div>
    </fieldset>
    <div className="fiscal-recipient-grid">
     <label className="fiscal-field fiscal-field-full">Nome do tomador
      <input required readOnly={value.taker_kind==='PATIENT'} maxLength={200}
       value={value.taker_name} onChange={e=>set('taker_name',e.target.value)}/>
     </label>
     <label className="fiscal-field">CPF
      <input required inputMode="numeric" autoComplete="off" placeholder="000.000.000-00"
       maxLength={14} value={formatCPF(value.taker_tax_id)}
       onChange={e=>set('taker_tax_id',e.target.value)}/>
     </label>
     <label className="fiscal-field">Endereço (opcional)
      <input maxLength={1000} value={value.taker_address}
       onChange={e=>set('taker_address',e.target.value)}/>
     </label>
     <label className="fiscal-field fiscal-field-full">Observação (opcional)
      <textarea rows={3} maxLength={2000} value={value.notes}
       onChange={e=>set('notes',e.target.value)}/>
     </label>
    </div>
   </section>}

   {error&&<p role="alert" className="fiscal-validation-error">{error}</p>}
   <div className="fiscal-actions">
    <button type="button" onClick={()=>done(null)}>Cancelar</button>
    <button type="submit" className="fiscal-primary">
     {noInvoice?'Confirmar recebimento S/N':'Confirmar recebimento e solicitar NF'}
    </button>
   </div>
  </form>
 </AppDialog>;
}

export function confirmFiscalPayment(context:Context):Promise<FiscalRecipient|null>{
 return new Promise(resolve=>{
  const host=document.createElement('div');document.body.append(host);
  const root=createRoot(host);let completed=false;
  root.render(<Confirmation context={context} done={value=>{
   if(completed)return;completed=true;resolve(value);
   setTimeout(()=>{root.unmount();host.remove()},0);
  }}/>);
 });
}
