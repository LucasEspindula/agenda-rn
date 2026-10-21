'use client';
import {cents,paymentDifference,paymentMethods,type PaymentPart} from '@/lib/fiscal-money';
import {useState} from 'react';
import MoneyInput from './money-input';
import {formatBRL,parseBRL} from '@/lib/money';
import {TrashIcon} from './billing-icons';
export default function PaymentParts({value,onChange,amount}:{value:PaymentPart[];onChange:(parts:PaymentPart[])=>void;amount:number}){
 const change=(index:number,patch:Partial<PaymentPart>)=>onChange(value.map((p,i)=>i===index?{...p,...patch}:p));
 const validAmounts=value.every(p=>p.amount>=0);
 const difference=validAmounts?paymentDifference(value,amount):0;
 return <fieldset className="payment-parts">
  <legend>Formas de pagamento</legend>
  <div className="payment-parts-list">
   {value.map((part,index)=><div className="payment-part" key={index}>
    <label>Método<select aria-label={'Método '+(index+1)} value={part.method}
     onChange={e=>change(index,{method:e.target.value,installments:e.target.value==='CREDIT_CARD'?1:null})}>
     {Object.entries(paymentMethods).map(([key,label])=><option value={key} key={key}>{label}</option>)}
    </select></label>
    <label>Valor<PaymentAmount value={part.amount} label={'Valor da forma '+(index+1)}
     onChange={amount=>change(index,{amount})}/></label>
    {part.method==='CREDIT_CARD'&&<label>Parcelas<input aria-label={'Parcelas '+(index+1)}
     type="number" min="1" step="1" required value={part.installments??''}
     onChange={e=>change(index,{installments:Number(e.target.value)})}/></label>}
    <button type="button" className="billing-icon-action billing-delete"
     title="Remover forma de pagamento" aria-label={'Remover forma '+(index+1)}
     onClick={()=>onChange(value.filter((_,i)=>i!==index))}><TrashIcon/></button>
   </div>)}
  </div>
  <div className="payment-parts-toolbar">
   <button type="button" className="billing-secondary billing-add"
    onClick={()=>onChange([...value,{method:'PIX',amount:0}])}>+ Adicionar forma</button>
   <p role="status">{!validAmounts?'Revise os valores das formas de pagamento.':
    <>Total das formas: <strong>{formatBRL((cents(amount)-difference)/100)}</strong>
     <span className={difference===0&&value.length?'payment-parts-ok':difference!==0?'payment-parts-difference':''}>
      {difference===0&&value.length?'✓ Valores conferidos':
       difference>=0?'Falta '+formatBRL(difference/100):'Excede '+formatBRL(-difference/100)}
     </span>
    </>}</p>
  </div>
 </fieldset>;
}

function PaymentAmount({value,label,onChange}:{value:number;label:string;onChange:(value:number)=>void}){
 const [draft,setDraft]=useState<{source:number;text:string}|null>(null);
 return <MoneyInput aria-label={label} required value={draft?.source===value?draft.text:value} onChange={text=>{
  try{const amount=parseBRL(text)??-1;setDraft({source:amount,text});onChange(amount)}catch{setDraft({source:-1,text});onChange(-1)}
 }}/>;
}
export function PaymentPartsReadOnly({value}:{value:PaymentPart[]}){
 return <section className="payment-parts" aria-label="Composição do pagamento registrada"><h3>Formas de pagamento · somente leitura</h3>{value.length?<ul>{value.map((part,index)=><li key={index}>{paymentMethods[part.method]||'Outra forma'} · {formatBRL(part.amount)}{part.method==='CREDIT_CARD'&&part.installments?` · ${part.installments} parcelas`:''}</li>)}</ul>:<p>Composição não informada no registro anterior.</p>}</section>;
}
