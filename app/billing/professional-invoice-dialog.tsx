"use client";
import {useMemo,useState,type FormEvent} from "react";
import AppDialog from "@/components/app-dialog";
import PaymentParts,{PaymentPartsReadOnly} from "@/components/payment-parts";
import MoneyInput from "@/components/money-input";
import {cents,validPaymentParts,type PaymentPart} from "@/lib/fiscal-money";
import {formatBRL,parseBRL} from "@/lib/money";
import {formatDateBR} from "@/lib/date-format";
import {payerKey} from "@/lib/billing-eligibility";
import type {BillingData,BillingRow,Invoice} from "@/lib/billing-types";

const belongsToProfessionalInvoice=(row:BillingRow,invoiceId?:string)=>
  !!row.record?.id && !!row.record.professional_id &&
  row.record.billing_method==="CONVENIO" && row.record.settlement_mode==="INVOICE" &&
  row.status_atendimento==="realized" && (!row.invoice || row.invoice.id===invoiceId);
const actualPayer=(row:BillingRow)=>payerKey(row.record?.effective_payer_name_snapshot||row.record?.patient_insurance_snapshot||row.insurance||"");
const tryMoney=(value:unknown)=>{try{return parseBRL(value)||0}catch{return 0}};

export default function ProfessionalInvoiceDialog({data,initial,onClose,onSaved}:{
 data:BillingData;initial?:Invoice|null;onClose:()=>void;onSaved:()=>void;
}){
 const linked=data.rows.filter(row=>row.invoice?.id===initial?.id && row.record?.professional_id);
 const [entity,setEntity]=useState(initial?.billing_entity_id||"");
 const [payer,setPayer]=useState(payerKey(initial?.payer||""));
 const [number,setNumber]=useState(initial?.invoice_number||"");
 const [issued,setIssued]=useState(initial?.issue_date?.slice(0,10)||new Date().toISOString().slice(0,10));
 const [paidAt,setPaidAt]=useState(initial?.paid_at?.slice(0,10)||"");
 const [gross,setGross]=useState<string|number|null>(initial?.total_amount??"");
 const [net,setNet]=useState<string|number|null>(initial?.net_amount??"");
 const [notes,setNotes]=useState(initial?.notes||"");
 const [selected,setSelected]=useState<string[]>(()=>linked.map(r=>r.record!.id));
 const [amounts,setAmounts]=useState<Record<string,string>>(()=>Object.fromEntries(
   linked.map(row=>[row.record!.id,String(row.invoice_item?.received_amount??"")])));
 const [parts,setParts]=useState<PaymentPart[]>(()=> (data.payment_parts||[]).filter(x=>x.invoice_id===initial?.id));
 const [error,setError]=useState(""),[busy,setBusy]=useState(false);
 const locked=!!initial&&(initial.status!=="ACTIVE"&&!!initial.status || !!initial.voided_at || !!initial.paid_at);
 const adjustment=initial?.closing_adjustment||0;
 const payerOptions=useMemo(()=>[...new Set(data.rows.filter(row=>belongsToProfessionalInvoice(row,initial?.id) &&
   (!entity||row.record?.billing_entity_id===entity)).map(actualPayer).filter(Boolean))].sort(),[data,entity,initial?.id]);
 const entities=data.entities.filter(e=>e.active||e.id===initial?.billing_entity_id);
 const candidates=data.rows.filter(row=>belongsToProfessionalInvoice(row,initial?.id) &&
   row.record?.billing_entity_id===entity && actualPayer(row)===payer);
 const picked=candidates.filter(row=>selected.includes(row.record!.id));
 const selectedTotal=picked.reduce((sum,row)=>sum+cents(tryMoney(amounts[row.record!.id])),0);
 const expectedTotal=cents(tryMoney(net));
 const delta=expectedTotal-selectedTotal-cents(adjustment);
 const amountSet=(id:string,value:string)=>setAmounts(old=>({...old,[id]:value}));
 async function submit(event:FormEvent<HTMLFormElement>){
   event.preventDefault();if(busy||locked)return;
   setError("");
   if(!entity||!payer||!number.trim()||!issued){setError("Informe empresa, pagador, número da NF e data de emissão.");return}
   if(!selected.length||picked.length!==selected.length){setError("Selecione cobranças válidas para a empresa e o pagador.");return}
   if(selected.some(id=>amounts[id]===undefined||amounts[id]===""||tryMoney(amounts[id])<0)){setError("Informe o valor de cada cobrança.");return}
   const netValue=tryMoney(net),grossValue=tryMoney(gross);
   if(net===null||net===""||netValue<0||gross===null||gross===""||grossValue<0){setError("Informe os valores bruto e líquido.");return}
   if(delta!==0){setError("A soma dos valores individuais deve conferir com o valor líquido da NF.");return}
   if(paidAt&&!validPaymentParts(parts,netValue)){setError("As formas de pagamento precisam totalizar o valor líquido.");return}
   setBusy(true);
   try{
    const response=await fetch("/api/billing",{method:"POST",headers:{"content-type":"application/json"},
     body:JSON.stringify({kind:"professional_invoice",data:{
      id:initial?.id||undefined,updated_at:initial?.updated_at||undefined,billing_entity_id:entity,payer,
      invoice_number:number.trim(),issue_date:issued,paid_at:paidAt||null,total_amount:grossValue,net_amount:netValue,
      notes,record_ids:selected,item_amounts:Object.fromEntries(selected.map(id=>[id,tryMoney(amounts[id])])),
      closing_adjustment:adjustment,closing_adjustment_reason:initial?.closing_adjustment_reason||null,
      payment_parts:paidAt?parts:[]}})});
    const result=await response.json();if(!response.ok)throw Error(result.error||"Não foi possível registrar a NF.");
    onSaved();onClose();
   }catch(e){setError(e instanceof Error?e.message:"Falha ao salvar a NF.");}finally{setBusy(false)}
 }
 return <AppDialog label="Nota fiscal por cobrança profissional" busy={busy} onClose={onClose}>
  <div className="billing-section-head"><h2>{initial?"NF por cobranças profissionais":"Nova NF por cobranças profissionais"}</h2>
    <button type="button" onClick={onClose} disabled={busy} className="billing-secondary">Fechar</button></div>
  {locked&&<p role="status" className="billing-historical-note">Documento já pago ou histórico: somente leitura. Para corrigir uma NF paga, utilize o fluxo fiscal de cancelamento/substituição autorizado.</p>}
  <form onSubmit={e=>void submit(e)}>
   <div className="billing-form-grid">
    <label>Empresa emissora (PJ/PF)<select required disabled={!!initial} value={entity} onChange={e=>{setEntity(e.target.value);setPayer("");setSelected([]);setAmounts({})}}>
      <option value="">Selecione</option>{entities.map(e=><option key={e.id} value={e.id}>{e.trade_name||e.name}</option>)}</select></label>
    <label>Pagador / repassador<select required disabled={!!initial||!entity} value={payer} onChange={e=>{setPayer(e.target.value);setSelected([]);setAmounts({})}}>
      <option value="">Selecione</option>{payerOptions.map(key=><option key={key} value={key}>{key}</option>)}</select></label>
    <label>Número da NF<input required disabled={locked} value={number} onChange={e=>setNumber(e.target.value)}/></label>
    <label>Data de emissão<input type="date" required disabled={locked} value={issued} onChange={e=>setIssued(e.target.value)}/></label>
    <label>Valor bruto<MoneyInput disabled={locked} value={gross} onChange={setGross}/></label>
    <label>Valor líquido<MoneyInput disabled={locked} value={net} onChange={setNet}/></label>
    <label>Data do pagamento<input type="date" disabled={locked} value={paidAt} onChange={e=>setPaidAt(e.target.value)}/></label>
   </div>
   <h3>Cobranças profissionais vinculadas</h3>
   <p>Selecione as cobranças que pertencem à mesma entidade e ao mesmo pagador. Os valores são individuais, sem rateio automático.</p>
   {!entity||!payer?<p>Selecione a entidade e o pagador para listar as cobranças.</p>:
    <div className="billing-items">{candidates.map(row=><div key={row.record!.id} className="invoice-picker-row">
     <label className="billing-check">
      <input type="checkbox" disabled={locked} checked={selected.includes(row.record!.id)} onChange={e=>{
       const id=row.record!.id;setSelected(old=>e.target.checked?[...old,id]:old.filter(x=>x!==id));
      }}/>
      <span>{row.patient} · {formatDateBR(row.date)} · {data.doctors.find(d=>d.id===row.doctor_id)?.name||row.doctor_id} · {row.procedure}</span>
     </label>
     {selected.includes(row.record!.id)&&<label>Valor desta cobrança
      <MoneyInput disabled={locked} value={amounts[row.record!.id]||""} aria-label={"Valor de "+row.patient+" / "+row.doctor_id} onChange={v=>amountSet(row.record!.id,v)}/></label>}
    </div>)}
    {!candidates.length&&<p>Nenhuma cobrança elegível para esta entidade e pagador.</p>}
    </div>}
   {adjustment!==0&&<p className="billing-historical-note">Ajuste histórico preservado: {formatBRL(adjustment)}</p>}
   <p role="status">Selecionadas: {selected.length} · Total dos itens: {formatBRL(selectedTotal/100)} · Valor líquido: {formatBRL(tryMoney(net))} · {delta===0?"Valores conferidos":delta>0?"Falta distribuir "+formatBRL(delta/100):"Excede "+formatBRL(-delta/100)}</p>
   {paidAt&&(locked?<PaymentPartsReadOnly value={parts}/>:<PaymentParts value={parts} onChange={setParts} amount={tryMoney(net)}/>)}
   <label>Observações<textarea disabled={locked} value={notes} onChange={e=>setNotes(e.target.value)} maxLength={2000}/></label>
   {error&&<p role="alert" className="billing-error">{error}</p>}
   <div className="billing-modal-actions"><button type="button" onClick={onClose} className="billing-secondary">Fechar</button>
    {!locked&&<button type="submit" disabled={busy||!selected.length} className="billing-primary">{busy?"Salvando…":"Salvar NF"}</button>}</div>
  </form>
 </AppDialog>;
}
