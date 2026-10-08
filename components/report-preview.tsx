"use client";
import {useEffect,useState,type ReactNode} from "react";
import {createPortal} from "react-dom";
import {PrintIcon} from "@/components/billing-icons";

export default function ReportPreview({title,orientation="portrait",onClose,children}:{title:string;orientation?:"portrait"|"landscape";onClose:()=>void;children:ReactNode}){
 const [mounted,setMounted]=useState(false);
 useEffect(()=>{setMounted(true);return()=>setMounted(false)},[]);
 if(!mounted)return null;
 return createPortal(<section className={"report-preview report-preview-"+orientation} role="dialog" aria-modal="true" aria-label={"Visualização: "+title}>
  <style>{`@page { size: A4 ${orientation}; margin: 10mm 12mm; }`}</style>
  <header className="report-preview-toolbar no-print"><strong>{title}</strong><div><button className="billing-secondary" onClick={()=>window.print()}><PrintIcon/> Imprimir / Salvar PDF</button><button className="billing-secondary report-preview-close" aria-label="Fechar visualização" onClick={onClose}>×</button></div></header>
  <div className="report-preview-scroll"><div className="report-preview-page">{children}</div></div>
 </section>,document.body);
}
