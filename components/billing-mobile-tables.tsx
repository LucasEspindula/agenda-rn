"use client";

import {useEffect} from "react";

// A React-independent enhancement of native data tables.  Only add attributes:
// React continues to own the row content, filters, edit forms and actions.
export default function BillingMobileTables(){
 useEffect(()=>{
  let frame=0;
  const enhance=()=>{
   frame=0;
   document.querySelectorAll<HTMLTableElement>(
    ".billing-main:not(.billing-mobile-no-cards) table.billing-table"
   ).forEach(table=>{
    if(table.closest("dialog, [data-billing-mobile-skip]"))return;
    const headings=Array.from(table.tHead?.rows[0]?.cells||[]).map(th=>th.textContent?.replace(/\s+/g," ").trim()||"");
    if(!headings.length)return;
    table.classList.add("billing-mobile-card-table");
    for(const row of Array.from(table.tBodies).flatMap(body=>Array.from(body.rows))){
     Array.from(row.cells).forEach((cell,index)=>{
      const label=headings[index]||"Detalhes";
      if(cell.getAttribute("data-mobile-label")!==label)cell.setAttribute("data-mobile-label",label);
      if(label.toLocaleLowerCase("pt-BR").includes("aç")||label.toLowerCase().includes("operaç"))
       cell.classList.add("billing-mobile-actions-cell");
     });
    }
   });
  };
  const schedule=()=>{if(!frame)frame=window.requestAnimationFrame(enhance)};
  const observer=new MutationObserver(schedule);
  observer.observe(document.body,{childList:true,subtree:true});
  schedule();
  return ()=>{observer.disconnect();if(frame)window.cancelAnimationFrame(frame)};
 },[]);
 return null;
}
