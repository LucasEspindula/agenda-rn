"use client";

import {useEffect,useState} from "react";
import {ChevronRight,Receipt,FileText,Wallet,Building2,ShieldAlert,CalendarRange,BookOpen,ClipboardList,ScrollText} from "lucide-react";

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
// Seções do Faturamento dentro do menu único do celular, espelhando a navegação real da página.
export default function BillingSectionLinks({onNavigate}:{onNavigate?:()=>void}){
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
   return ()=>{obs.disconnect();if(timer)window.cancelAnimationFrame(timer)};
 },[]);
 return <nav className="mobile-app-menu-links mobile-app-sections billing-header-sections" aria-label="Seções do Faturamento">
  <span className="mobile-app-menu-caption">FATURAMENTO</span>
  {items.map(item=>{const Icon=iconFor(item.label);return item.href?
   <a key={item.id} className="billing-header-link" href={item.href} aria-current={item.current?"page":undefined} onClick={()=>onNavigate?.()}>
    <Icon size={20} aria-hidden="true"/><span>{item.label}</span><ChevronRight size={17} aria-hidden="true"/>
   </a>:
   <button key={item.id} type="button" aria-current={item.current?"page":undefined} onClick={()=>{item.button?.click();onNavigate?.()}}>
    <Icon size={20} aria-hidden="true"/><span>{item.label}</span><ChevronRight size={17} aria-hidden="true"/>
   </button>})}
  {!items.length&&<span className="billing-header-loading">Seções do Faturamento</span>}
 </nav>;
}
