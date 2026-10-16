"use client";
import {useState} from "react";
import AppDialog from "@/components/app-dialog";
import {formatDateBR} from "@/lib/date-format";

export type GuideItem={
 billing_record_id:string;patient:string;professional_name:string;service_date:string;
 status:string;guide_received_at:string|null;submitted_at:string|null;
 portal_protocol:string|null;notes:string;destination_key:string;
 submission_channel_code:string;destination_confirmed:boolean;
};
const channels=[["PORTAL_CONVENIO","Portal do convênio"],["COOPERATIVA","Cooperativa"],["MANUAL","Canal manual"]];
export default function PortalGuideDialog({item,today,onClose,onSaved}:{
 item:GuideItem;today:string;onClose:()=>void;onSaved:()=>void;
}){
 const [destination,setDestination]=useState(item.destination_key);
 const [channel,setChannel]=useState(item.submission_channel_code||"PORTAL_CONVENIO");
 const [received,setReceived]=useState(item.guide_received_at||"");
 const [submitted,setSubmitted]=useState(item.submitted_at||"");
 const [protocol,setProtocol]=useState(item.portal_protocol||"");
 const [notes,setNotes]=useState(item.notes||"");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const done=item.status==="FATURADO";
 const fixedChannel=item.submission_channel_code==="PORTAL_CONVENIO"||item.submission_channel_code==="COOPERATIVA";
 async function save(action:"SAVE_PENDING"|"MARK_SUBMITTED"){
  if(busy||done)return;
  if(destination.trim().length<2){setError("Informe o destino da guia.");return;}
  if(action==="MARK_SUBMITTED"&&(!received||!submitted||protocol.trim().length<3)){
   setError("Para marcar como Faturado, informe recebimento da guia, data e protocolo do portal.");return;
  }
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/billing/portal",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({action,data:{
     billing_record_id:item.billing_record_id,
     destination_key:destination,submission_channel_code:channel,
     guide_received_at:received||null,
     submitted_at:action==="MARK_SUBMITTED"?submitted:null,
     portal_protocol:action==="MARK_SUBMITTED"?protocol:null,
     notes
    }})
   });
   const result=await response.json();
   if(!response.ok)throw Error(result.error||"Falha ao registrar a guia.");
   onSaved();
  }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível registrar a guia.");}
  finally{setBusy(false);}
 }
 return <AppDialog label="Guia do convênio" onClose={onClose} busy={busy}>
  <div className="billing-section-head">
   <h2>{done?"Guia apresentada no portal":"Registro de guia de convênio"}</h2>
   <button type="button" className="billing-secondary" disabled={busy} onClick={onClose}>Fechar</button>
  </div>
  <p>{item.patient} · {item.professional_name} · {formatDateBR(item.service_date)}</p>
  <div className="billing-form-grid">
   <label>Destino da apresentação
    <input maxLength={120} required disabled={done} value={destination}
      placeholder="Ex.: UNIMED ou COOPA" onChange={e=>setDestination(e.target.value)}/>
   </label>
   <label>Canal de apresentação
    <select disabled={done||fixedChannel} value={channel} onChange={e=>setChannel(e.target.value)}>
     {channels.map(([id,name])=><option key={id} value={id}>{name}</option>)}
    </select>
   </label>
   <label>Data de recebimento da guia
    <input type="date" max={today} disabled={done} value={received} onChange={e=>setReceived(e.target.value)}/>
   </label>
   <label>Data de apresentação no portal
    <input type="date" max={today} disabled={done} value={submitted} onChange={e=>setSubmitted(e.target.value)}/>
   </label>
   <label>Protocolo de envio
    <input maxLength={120} disabled={done} value={protocol} onChange={e=>setProtocol(e.target.value)}/>
   </label>
  </div>
  <label>Observações
   <textarea maxLength={2000} disabled={done} value={notes} onChange={e=>setNotes(e.target.value)}/>
  </label>
  <p className="billing-historical-note">Faturado no portal não significa Pago e não quita a nota fiscal.</p>
  {error&&<p className="billing-error" role="alert">{error}</p>}
  <div className="billing-modal-actions">
   <button type="button" className="billing-secondary" disabled={busy} onClick={onClose}>Fechar</button>
   {!done&&<>
    <button type="button" className="billing-secondary" disabled={busy} onClick={()=>void save("SAVE_PENDING")}>Salvar guia</button>
    <button type="button" className="billing-primary" disabled={busy} onClick={()=>void save("MARK_SUBMITTED")}>Marcar Faturado no portal</button>
   </>}
  </div>
 </AppDialog>;
}
