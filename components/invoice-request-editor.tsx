"use client";
import {useState} from "react";
import {createRoot} from "react-dom/client";
import AppDialog from "./app-dialog";
import type {InvoiceRequest} from "@/lib/billing-types";
import {formatCPF,normalizeCPF,validCPF} from "@/lib/cpf";
import "./invoice-request-editor.css";

type Fields={taker_kind:"PATIENT"|"OTHER";taker_name:string;taker_tax_id:string;taker_address:string;notes:string};
type Props={request:InvoiceRequest;onClose:()=>void;onSaved:()=>void};
export default function InvoiceRequestEditor({request,onClose,onSaved}:Props){
 const [form,setForm]=useState<Fields>({
  taker_kind:request.taker_kind,taker_name:request.taker_name,
  taker_tax_id:request.taker_tax_id,taker_address:request.taker_address||"",notes:request.notes||""
 });
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const field=(key:keyof Fields,value:string)=>setForm(v=>({...v,[key]:value}));
 async function save(event:React.FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(busy)return;
  if(!form.taker_name.trim()||!validCPF(form.taker_tax_id)){
   setError("Informe nome e CPF válido do tomador.");return;
  }
  if(!form.taker_address.trim()){
   setError("Informe o endereço completo do tomador para solicitar a NF.");return;
  }
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/billing",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({kind:"edit_invoice_request",data:{
     id:request.id,updated_at:request.updated_at,
     taker_kind:form.taker_kind,taker_name:form.taker_name.trim(),
     taker_tax_id:normalizeCPF(form.taker_tax_id),
     taker_address:form.taker_address.trim(),notes:form.notes
    }})
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||"Não foi possível atualizar a solicitação.");
   onSaved();
  }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar.");}
  finally{setBusy(false);}
 }
 return <AppDialog label="Editar solicitação de Nota Fiscal" onClose={onClose}
   className="invoice-request-editor-dialog" busy={busy}>
  <form className="invoice-request-editor" onSubmit={save}>
   <h2>Editar solicitação de NF</h2>
   <p className="invoice-request-context">
    {request.patient_name_snapshot} · {request.procedure_snapshot}
   </p>
   <div className="invoice-request-fields">
    <fieldset><legend>Emitir NF em nome de</legend>
     <div className="invoice-request-options">
      <label><input type="radio" name="edit_request_kind" checked={form.taker_kind==="PATIENT"}
       onChange={()=>setForm(v=>({...v,taker_kind:"PATIENT",taker_name:request.patient_name_snapshot}))}/>
       Próprio paciente</label>
      <label><input type="radio" name="edit_request_kind" checked={form.taker_kind==="OTHER"}
       onChange={()=>setForm(v=>({...v,taker_kind:"OTHER",taker_name:v.taker_kind==="PATIENT"?"":v.taker_name}))}/>
       Outra pessoa</label>
     </div>
    </fieldset>
    <label className="invoice-request-span">Nome do tomador
     <input required maxLength={200} readOnly={form.taker_kind==="PATIENT"}
      value={form.taker_kind==="PATIENT"?request.patient_name_snapshot:form.taker_name}
      onChange={e=>field("taker_name",e.target.value)}/>
    </label>
    <label>CPF do tomador
     <input required inputMode="numeric" maxLength={14} placeholder="000.000.000-00"
      value={formatCPF(form.taker_tax_id)} onChange={e=>field("taker_tax_id",e.target.value)}/>
    </label>
    <label>Endereço completo do tomador
     <input required maxLength={1000} placeholder="Rua, número, bairro, cidade/UF e CEP" value={form.taker_address}
      onChange={e=>field("taker_address",e.target.value)}/>
    </label>
    <label className="invoice-request-span">Observação (opcional)
     <textarea rows={3} maxLength={2000} value={form.notes}
      onChange={e=>field("notes",e.target.value)}/>
    </label>
   </div>
   <p className="invoice-request-readonly">Valor, data do pagamento, entidade recebedora e atendimento permanecem vinculados ao registro financeiro original.</p>
   {error&&<p role="alert" className="invoice-request-error">{error}</p>}
   <div className="invoice-request-actions">
    <button type="button" disabled={busy} onClick={onClose}>Voltar</button>
    <button type="submit" disabled={busy}>{busy?"Salvando...":"Salvar correção"}</button>
   </div>
  </form>
 </AppDialog>;
}
export function editPendingInvoiceRequest(request:InvoiceRequest):Promise<boolean>{
 return new Promise(resolve=>{
  const host=document.createElement("div");document.body.append(host);
  const root=createRoot(host);let complete=false;
  const finish=(result:boolean)=>{
   if(complete)return;complete=true;resolve(result);
   setTimeout(()=>{root.unmount();host.remove()},0);
  };
  root.render(<InvoiceRequestEditor request={request}
    onClose={()=>finish(false)} onSaved={()=>finish(true)}/>);
 });
}
