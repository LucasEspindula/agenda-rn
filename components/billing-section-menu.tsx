"use client";

import {useEffect,useRef,useState} from "react";
import {Menu,Receipt,FileText,Wallet,Building2,ShieldAlert,CalendarRange,BookOpen,ClipboardList,ScrollText} from "lucide-react";

type Item={id:string;label:string;href?:string;button?:HTMLButtonElement;current:boolean};
const iconFor=(label:string)=>{
 const k=label.toLocaleLowerCase("pt-BR");
 if(k.includes("nota")||k.includes("fiscal"))return FileText;
 if(k.includes("convênio"))return ClipboardList;
 if(k.includes("glosa"))return ShieldAlert;
 if(k.includes("entidade"))return Building2;
 if(k.includes("despesa"))return Wallet;
 if(k.includes("fechamento"))return CalendarRange;
 if(k.includes("logs"))return ScrollText;
 if(k.includes("solicita"))return BookOpen;
 return Receipt;
};
export default function BillingSectionMenu(){
 const menu=useRef<HTMLDetailsElement>(null);
 const [items,setItems]=useState<Item[]>([]);
 useEffect(()=>{
  let timer=0;
  const sync=()=>{
   timer=0;
   const nav=document.querySelector(".billing-subnav .billing-subnav-nav");
   const elements=nav?.querySelectorAll<HTMLAnchorElement|HTMLButtonElement>("a, button");
   const found=Array.from(elements||[]).filter(el=>el.getAttribute("aria-hidden")!=="true").map((el,i)=>({
    id:el instanceof HTMLAnchorElement?el.getAttribute("href")||String(i):String(i),
    label:Array.from(el.childNodes).filter(node=>node.nodeType===Node.TEXT_NODE).map(node=>node.textContent||"").join(" ").replace(/\s+/g," ").trim(),
    href:el instanceof HTMLAnchorElement?el.getAttribute("href")||undefined:undefined,
    button:el instanceof HTMLButtonElement?el:undefined,
    current:el.getAttribute("aria-current")==="page",
   }));
   setItems(previous=>JSON.stringify(previous.map(x=>[x.id,x.label,x.current]))===JSON.stringify(found.map(x=>[x.id,x.label,x.current]))?previous:found);
  };
  const schedule=()=>{if(!timer)timer=window.requestAnimationFrame(sync)};
  const obs=new MutationObserver(schedule);
  obs.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["aria-current"]});
  schedule();
  const outside=(event:PointerEvent)=>{if(menu.current?.open&&!menu.current.contains(event.target as Node))menu.current.open=false};
  document.addEventListener("pointerdown",outside);
  return ()=>{obs.disconnect();document.removeEventListener("pointerdown",outside);if(timer)window.cancelAnimationFrame(timer)};
 },[]);
 return <details className="agenda-header-sections billing-header-sections" ref={menu} onKeyDown={e=>{if(e.key==="Escape"&&menu.current){menu.current.open=false;e.stopPropagation()}}}>
  <summary title="Áreas do Faturamento" aria-label="Abrir menu de seções do Faturamento"><Menu size={23} aria-hidden="true"/></summary>
  <nav className="agenda-header-sections-list" aria-label="Seções do Faturamento">
   <span className="agenda-header-menu-caption">FATURAMENTO</span>
   {items.map(item=>{const Icon=iconFor(item.label);return item.href?
    <a key={item.id} className="billing-header-link" href={item.href} aria-current={item.current?"page":undefined} onClick={()=>{if(menu.current)menu.current.open=false}}>
     <Icon size={19} aria-hidden="true"/><span>{item.label}</span>
    </a>:
    <button key={item.id} type="button" aria-current={item.current?"page":undefined} onClick={()=>{item.button?.click();if(menu.current)menu.current.open=false}}>
     <Icon size={19} aria-hidden="true"/><span>{item.label}</span>
    </button>})}
   {!items.length&&<span className="billing-header-loading">Seções do Faturamento</span>}
  </nav>
 </details>;
}
