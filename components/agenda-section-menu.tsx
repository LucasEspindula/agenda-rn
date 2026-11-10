"use client";

import {useEffect, useState} from "react";
import {Ban, CalendarDays, ChevronRight, ClipboardList, History, ScrollText, Users} from "lucide-react";

type AgendaView = "agenda" | "patients" | "requests" | "notifications" | "audit" | "cancelled";
type AgendaItem = {view: AgendaView; label: string};
const names: Record<AgendaView, string> = {
  agenda: "Agenda",
  patients: "Pacientes",
  requests: "Solicitações",
  notifications: "Histórico de alterações",
  audit: "Logs Agendamento",
  cancelled: "Cancelados",
};
const icons = {
  agenda: CalendarDays,
  patients: Users,
  requests: ClipboardList,
  notifications: History,
  audit: ScrollText,
  cancelled: Ban,
};
const defaults: AgendaItem[] = [{view:"agenda",label:"Agenda"},{view:"patients",label:"Pacientes"},{view:"cancelled",label:"Cancelados"}];

// Seções da Agenda dentro do menu único do celular. Os itens espelham os botões reais
// da agenda (.agenda-nav e Cancelados), então as permissões de cada papel são as mesmas.
export default function AgendaSectionLinks({role,onNavigate}:{role:string;onNavigate?:()=>void}){
  const [items,setItems]=useState<AgendaItem[]>(defaults);
  const [selected,setSelected]=useState<AgendaView>("agenda");

  useEffect(()=>{
    let observer:MutationObserver|null=null;
    let bootstrap:MutationObserver|null=null;
    const allowed=(view:string)=>{
      if(view==="requests"||view==="audit")return role==="general_manager"||role==="secretary";
      if(view==="notifications")return role==="doctor";
      return view==="agenda"||view==="patients";
    };
    const sync=()=>{
      const list=[...document.querySelectorAll<HTMLButtonElement>(".agenda-nav .agenda-nav-item")]
        .filter(el=>allowed(el.dataset.view||"")&&!el.classList.contains("hidden"))
        .map(el=>({view:el.dataset.view as AgendaView,label:names[el.dataset.view as AgendaView]}));
      if(list.length)setItems(document.getElementById("cancelledPageBtn")?[...list,{view:"cancelled",label:names.cancelled}]:list);
      if(document.querySelector("#cancelledView.active")){setSelected("cancelled");return}
      const current=document.querySelector<HTMLButtonElement>(".agenda-nav .agenda-nav-item.active");
      if(current&&allowed(current.dataset.view||""))setSelected(current.dataset.view as AgendaView);
    };
    const attach=()=>{
      const nav=document.querySelector(".agenda-nav");
      if(!nav)return false;
      observer=new MutationObserver(sync);
      observer.observe(nav,{childList:true,subtree:true,attributes:true,attributeFilter:["class","aria-current"]});
      sync();
      return true;
    };
    if(!attach()){
      bootstrap=new MutationObserver(()=>{if(attach())bootstrap?.disconnect()});
      bootstrap.observe(document.body,{childList:true,subtree:true});
    }
    return ()=>{observer?.disconnect();bootstrap?.disconnect()};
  },[role]);

  const select=(view:AgendaView)=>{
    const source=view==="cancelled"
      ?document.getElementById("cancelledPageBtn")
      :document.querySelector<HTMLButtonElement>(`.agenda-nav .agenda-nav-item[data-view="${view}"]`);
    // O botão Cancelados fica oculto no celular, mas o clique programático continua valendo.
    if(!source||(view!=="cancelled"&&source.classList.contains("hidden")))return;
    source.click();
    setSelected(view);
    onNavigate?.();
  };

  return <nav className="mobile-app-menu-links mobile-app-sections" aria-label="Seções da Agenda">
    <span className="mobile-app-menu-caption">AGENDA</span>
    {items.map(item=>{
      const Icon=icons[item.view];
      return <button key={item.view} type="button" onClick={()=>select(item.view)}
        aria-current={selected===item.view?"page":undefined}>
        <Icon size={20} aria-hidden="true"/><span>{item.label}</span><ChevronRight size={17} aria-hidden="true"/>
      </button>;
    })}
  </nav>;
}
