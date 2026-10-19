"use client";
import {useState,type FormEvent} from "react";
import AppDialog from "@/components/app-dialog";
import PaymentParts from "@/components/payment-parts";
import {validPaymentParts,type PaymentPart} from "@/lib/fiscal-money";
import {parseBRL} from "@/lib/money";
import {formatDateBR} from "@/lib/date-format";
import type {BillingRow,BillingData} from "@/lib/billing-types";
import MoneyInput from "@/components/money-input";
import {confirmFiscalPayment} from "@/components/confirm-fiscal-payment";
type Draft={professional_id:string;professional_role:string;billing_entity_id:string;billing_method:string;
  commercial_modality_code:string;submission_channel_code:string;effective_payer_name_snapshot:string;
  patient_insurance_snapshot:string;payment_status:string;received_amount:string;paid_at:string;invoice_number:string;notes:string;no_invoice:boolean};
export default function ProfessionalChargeDialog({source,edit,data,onClose,onSaved}:{
 source:BillingRow;edit:boolean;data:BillingData;onClose:()=>void;onSaved:()=>void;
}){
 const existing=edit?source.record:null;
 const professionalIds=[...new Set([source.clinical_doctor_id||source.doctor_id,source.anesthetist_id].filter(Boolean))];
 const candidates=professionalIds.filter(id=>data.doctors.some(d=>d.id===id&&d.billing_enabled!==false)&&
   (edit||!data.rows.some(r=>r.attendance_id===source.attendance_id&&r.record?.professional_id===id)));
 const initial=edit?String(existing?.professional_id||""):(candidates[0]||"");
 const [draft,setDraft]=useState<Draft>({
  professional_id:initial,professional_role:existing?.professional_role||(initial===source.anesthetist_id?"ANESTHETIST":"SURGEON"),
  billing_entity_id:existing?.billing_entity_id||"",billing_method:existing?.billing_method||"CONVENIO",
  commercial_modality_code:existing?.commercial_modality_code||"LEGADO",
  submission_channel_code:existing?.submission_channel_code||(existing?.billing_method==="PARTICULAR"?"DIRETO":"PORTAL_CONVENIO"),
  effective_payer_name_snapshot:existing?.effective_payer_name_snapshot||"",
  patient_insurance_snapshot:existing?.patient_insurance_snapshot||source.insurance,
  payment_status:existing?.payment_status||"PENDENTE",
  received_amount:existing?.received_amount==null?"":String(existing.received_amount),
  paid_at:existing?.paid_at||"",invoice_number:existing?.invoice_number||"",notes:existing?.notes||"",no_invoice:!!existing?.no_invoice
 });
 const [parts,setParts]=useState<PaymentPart[]>(()=>(data.payment_parts||[]).filter(p=>p.billing_record_id===existing?.id));
 const [error,setError]=useState(""),[busy,setBusy]=useState(false);
 const set=(key:keyof Draft,value:string)=>setDraft(d=>({...d,[key]:value}));
 const entities=data.entities.filter(e=>e.id===existing?.billing_entity_id||
   (e.active&&data.links.some(link=>link.active&&link.doctor_id===draft.professional_id&&link.billing_entity_id===e.id)));
 const direct=draft.billing_method==="PARTICULAR"||draft.submission_channel_code==="DIRETO";
 const paid=draft.payment_status==="PAGO";
 const safeAmount=()=>{try{return parseBRL(draft.received_amount)||0}catch{return 0}};
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(busy||(edit&&source.invoice))return;
  setError("");
  if(!candidates.includes(draft.professional_id)){setError("Profissional não participa deste atendimento.");return}
  if(!entities.some(x=>x.id===draft.billing_entity_id)){setError("Selecione uma entidade vinculada ao profissional.");return}
  if(!direct&&paid){setError("Registre o pagamento por convênio na NF correspondente.");return}
  let amount:number|null=null;
  try{
   amount=draft.received_amount.trim()?parseBRL(draft.received_amount):null;
   const needsFiscal=direct&&paid&&draft.billing_method==="PARTICULAR"&&!draft.no_invoice&&!draft.invoice_number.trim()&&
     !(data.requests||[]).some(r=>r.billing_record_id===existing?.id&&r.status!=="CANCELLED");
   if(direct&&paid&&(amount==null||amount<0||!draft.paid_at||(!needsFiscal&&!validPaymentParts(parts,amount)))){
    setError("Informe valor, data e formas de pagamento que totalizem o valor recebido.");return;
   }
   setBusy(true);
   const activeRequest=(data.requests||[]).some(r=>r.billing_record_id===existing?.id&&r.status!=="CANCELLED");
   let fiscal:Awaited<ReturnType<typeof confirmFiscalPayment>>=null;
   if(direct&&paid&&draft.billing_method==="PARTICULAR"&&!draft.no_invoice&&!draft.invoice_number.trim()&&!activeRequest){
     const patient=data.patients?.find(p=>p.id===source.patient_id) || {id:source.patient_id||"",name:source.patient};
     fiscal=await confirmFiscalPayment({patient,amount,paidAt:draft.paid_at});
     if(!fiscal)return;
   }
   const body={kind:"professional_charge",data:{...draft,id:existing?.id||undefined,attendance_id:source.attendance_id,
    updated_at:existing?.updated_at||undefined,payment_status:direct?draft.payment_status:"PENDENTE",
    received_amount:direct?amount:null,paid_at:direct&&draft.paid_at?draft.paid_at:null,
    no_invoice:!!(fiscal?.no_invoice||draft.no_invoice),fiscal:fiscal?.no_invoice?undefined:(fiscal||undefined),payment_parts:direct&&paid?(fiscal?.payment_parts||parts):[]}};
   const response=await fetch("/api/billing",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
   const result=await response.json();if(!response.ok)throw Error(result.error||"Erro ao salvar cobrança.");
   onSaved();
  }catch(cause){setError(cause instanceof Error?cause.message:"Erro ao salvar cobrança.");}
  finally{setBusy(false)}
 }
 return <AppDialog label="Cobrança por profissional" busy={busy} onClose={onClose}>
  <div className="billing-section-head"><h2>Cobrança por profissional</h2>
   <button type="button" className="billing-secondary" disabled={busy} onClick={onClose}>Fechar</button></div>
  <p>{source.patient} · {formatDateBR(source.date)} · {source.procedure}</p>
  {edit&&source.invoice?<div className="billing-message"><p>A cobrança está vinculada à NF {source.invoice.invoice_number}. Edite a NF, preservando o histórico fiscal.</p>
   <button type="button" onClick={onClose}>Fechar</button></div>:
  <form onSubmit={e=>void save(e)}>
   <div className="billing-form-grid">
    <label>Profissional
     <select required disabled={edit} value={draft.professional_id} onChange={e=>{
      const id=e.target.value;setDraft(d=>({...d,professional_id:id,billing_entity_id:"",
       professional_role:id===source.anesthetist_id?"ANESTHETIST":"SURGEON"}))}}>
      <option value="">Selecione</option>{candidates.map(id=><option key={id} value={id}>{data.doctors.find(d=>d.id===id)?.name||id}</option>)}
     </select></label>
    <label>Papel
     <select value={draft.professional_role} onChange={e=>set("professional_role",e.target.value)}>
      <option value="PRIMARY">Principal</option><option value="SURGEON">Cirurgião</option>
      <option value="ANESTHETIST">Anestesista</option><option value="ASSISTANT">Assistente</option><option value="OTHER">Outro</option>
     </select></label>
    <label>Entidade recebedora (PJ/PF)
     <select required value={draft.billing_entity_id} onChange={e=>set("billing_entity_id",e.target.value)}>
      <option value="">Selecione</option>{entities.map(x=><option value={x.id} key={x.id}>{x.trade_name||x.name}</option>)}
     </select></label>
    <label>Forma de cobrança
     <select value={draft.billing_method} onChange={e=>setDraft(d=>({...d,billing_method:e.target.value,payment_status:"PENDENTE",
      commercial_modality_code:e.target.value==="PARTICULAR"?"PARTICULAR":"LEGADO",
      submission_channel_code:e.target.value==="PARTICULAR"?"DIRETO":"PORTAL_CONVENIO"}))}>
      <option value="PARTICULAR">Particular</option><option value="CONVENIO">Convênio</option>
     </select></label>
    <label>Modalidade
     <select value={draft.commercial_modality_code} onChange={e=>set("commercial_modality_code",e.target.value)}>
      <option value="PARTICULAR">Particular</option><option value="COOPERADA">Cooperada</option>
      <option value="PACOTE_SOCIAL">Pacote social</option><option value="LEGADO">A definir</option>
     </select></label>
    <label>Canal de apresentação
     <select value={draft.submission_channel_code} onChange={e=>setDraft(d=>({...d,submission_channel_code:e.target.value,payment_status:"PENDENTE"}))}>
      <option value="DIRETO">Direto</option><option value="PORTAL_CONVENIO">Portal do convênio</option>
      <option value="COOPERATIVA">Cooperativa</option><option value="MANUAL">Manual</option>
      <option value="LEGADO">A definir</option>
     </select></label>
    <label>Convênio do paciente<input readOnly value={draft.patient_insurance_snapshot}/></label>
    <label>Pagador ou repassador efetivo
     <input value={draft.effective_payer_name_snapshot} maxLength={200} onChange={e=>set("effective_payer_name_snapshot",e.target.value)} placeholder="Ex.: Coopmed, Coopa"/></label>
    {direct&&<>
     <label>Status de pagamento<select value={draft.payment_status} onChange={e=>set("payment_status",e.target.value)}>
      <option value="PENDENTE">Pendente</option><option value="PAGO" disabled={draft.billing_method==="CONVENIO"}>Pago</option></select></label>
     <label>Valor recebido<MoneyInput value={draft.received_amount} onChange={v=>set("received_amount",v)} aria-label="Valor recebido"/></label>
     <label>Data de pagamento<input type="date" value={draft.paid_at} onChange={e=>set("paid_at",e.target.value)}/></label>
     {draft.billing_method==="PARTICULAR"&&
      <label>Número da NF (se já emitida)<input value={draft.invoice_number} onChange={e=>set("invoice_number",e.target.value)}/></label>}
    </>}
   </div>
   {direct&&paid&&!(draft.billing_method==="PARTICULAR"&&!draft.invoice_number.trim()&&!(data.requests||[]).some(r=>r.billing_record_id===existing?.id&&r.status!=="CANCELLED"))&&<PaymentParts value={parts} onChange={setParts} amount={safeAmount()}/>}
   {direct&&draft.billing_method==="CONVENIO"&&<p className="billing-historical-note">Convênio com recebimento direto: a quitação ficará pendente até configurarmos o fluxo fiscal do repasse. Não marque como pago nesta tela.</p>}
   {direct&&paid&&draft.billing_method==="PARTICULAR"&&
    <label className="fiscal-radio"><input type="checkbox"
      checked={draft.no_invoice} onChange={e=>setDraft(d=>({...d,no_invoice:e.target.checked}))}/>
     Sem Nota Fiscal (S/N)
    </label>}
   {direct&&paid&&draft.billing_method==="PARTICULAR"&&!draft.no_invoice&&!draft.invoice_number.trim()&&
    <p className="billing-historical-note">Ao confirmar o pagamento particular, será solicitada a NF automaticamente, vinculada a esta cobrança e a esta entidade recebedora. Os dados do tomador serão confirmados antes de salvar.</p>}
   {!entities.length&&<p role="alert" className="billing-error">Cadastre o vínculo do profissional com uma entidade recebedora ativa.</p>}
   <label>Observações<textarea value={draft.notes} onChange={e=>set("notes",e.target.value)}/></label>
   {error&&<p role="alert" className="billing-error">{error}</p>}
   <div className="billing-modal-actions">
    <button type="button" className="billing-secondary" disabled={busy} onClick={onClose}>Cancelar</button>
    <button type="submit" className="billing-primary" disabled={busy||!entities.length}>{busy?"Salvando…":"Salvar cobrança"}</button>
   </div>
  </form>}
 </AppDialog>;
}