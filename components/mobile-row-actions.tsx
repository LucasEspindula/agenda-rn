"use client";

import {useState,type ReactNode} from "react";
import {ListChecks} from "lucide-react";
import AppDialog from "@/components/app-dialog";

export default function MobileRowActions({label,children}:{label:string;children:ReactNode}){
 const [open,setOpen]=useState(false);
 return <>
  <div className="billing-desktop-row-actions">{children}</div>
  <div className="billing-mobile-row-actions">
   <button type="button" className="billing-mobile-actions-trigger" aria-label={"Abrir "+label}
    onClick={()=>setOpen(true)}><ListChecks size={18} aria-hidden="true"/> Ações</button>
   {open&&<AppDialog label={label} onClose={()=>setOpen(false)} compact className="billing-mobile-actions-dialog">
    <h2>{label}</h2>
    <p>Selecione a operação desejada.</p>
    <div className="billing-mobile-actions-list" onClick={event=>{
     const target=event.target as HTMLElement;
     if(target.closest("button,a"))setOpen(false);
    }}>{children}</div>
    <button type="button" className="billing-secondary billing-mobile-actions-close" onClick={()=>setOpen(false)}>Cancelar</button>
   </AppDialog>}
  </div>
 </>;
}
