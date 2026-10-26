"use client";

import {useEffect, useRef, useState} from "react";
import {CalendarDays, ClipboardList, History, Menu, ScrollText, Users} from "lucide-react";

type AgendaView = "agenda" | "patients" | "requests" | "notifications" | "audit";
type AgendaItem = {view: AgendaView; label: string};
const names: Record<AgendaView, string> = {
  agenda: "Agenda",
  patients: "Pacientes",
  requests: "Solicitações",
  notifications: "Histórico de alterações",
  audit: "Logs Agendamento",
};
const icons = {
  agenda: CalendarDays,
  patients: Users,
  requests: ClipboardList,
  notifications: History,
  audit: ScrollText,
};
const defaults: AgendaItem[] = [{view:"agenda",label:"Agenda"},{view:"patients",label:"Pacientes"}];

export default function AgendaSectionMenu({role}:{role:string}){
  const menuRef=useRef<HTMLDetailsElement>(null);
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
      if(list.length)setItems(list);
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
    const closeOutside=(event:PointerEvent)=>{
      if(menuRef.current?.open&&!menuRef.current.contains(event.target as Node))menuRef.current.open=false;
    };
    document.addEventListener("pointerdown",closeOutside);
    return ()=>{observer?.disconnect();bootstrap?.disconnect();document.removeEventListener("pointerdown",closeOutside)};
  },[role]);

  const select=(view:AgendaView)=>{
    const source=document.querySelector<HTMLButtonElement>(`.agenda-nav .agenda-nav-item[data-view="${view}"]`);
    if(!source||source.classList.contains("hidden"))return;
    source.click();
    setSelected(view);
    if(menuRef.current)menuRef.current.open=false;
  };

  return <details className="agenda-header-sections" ref={menuRef} onKeyDown={event=>{
    if(event.key==="Escape"&&menuRef.current){menuRef.current.open=false;event.stopPropagation();}
  }}>
    <summary title="Áreas da Agenda" aria-label="Abrir menu de seções da Agenda">
      <Menu size={23} aria-hidden="true"/>
    </summary>
    <nav className="agenda-header-sections-list" aria-label="Seções da Agenda">
      <span className="agenda-header-menu-caption">NAVEGAÇÃO DA AGENDA</span>
      {items.map(item=>{
        const Icon=icons[item.view];
        return <button key={item.view} type="button" onClick={()=>select(item.view)}
          aria-current={selected===item.view?"page":undefined}>
          <Icon size={19} aria-hidden="true"/>
          <span>{item.label}</span>
          {selected===item.view&&<span className="agenda-header-current" aria-hidden="true">●</span>}
        </button>;
      })}
    </nav>
  </details>;
}
