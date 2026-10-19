import {randomBytes} from "node:crypto";
import {getSession} from "@/app/authz";
import {getSupabaseAdmin} from "@/lib/supabase-admin";
import {monthlyInvoiceStatus} from "@/lib/monthly-invoice-status";
import {monthlyReceiptComparison} from "@/lib/monthly-receipt-comparison";

const CSS="\n:root{--ink:#172126;--muted:#66747b;--line:#dfe5e8;--brand:#0b7f79;--red:#b42318;--amber:#8a5b00;--warnbg:#fff8e8}\n*{box-sizing:border-box}body{margin:0;background:#edf1f3;font-family:Inter,Segoe UI,Arial,sans-serif;color:var(--ink)}\n.page{width:1480px;margin:22px auto;background:#fff;padding:28px 30px 34px;box-shadow:0 8px 24px rgba(0,0,0,.07)}\n.page-break{break-before:page;page-break-before:always}\n.head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #d8e1e5;padding-bottom:14px}\n.brand{font-size:12px;font-weight:850;color:var(--brand);letter-spacing:.04em}\nh1{font-size:24px;margin:4px 0 3px}.company-name{font-size:14px;font-weight:750}\n.meta{text-align:right;color:var(--muted);font-size:11px;line-height:1.6}\n.period{display:inline-block;background:#e9f6f4;color:var(--brand);font-weight:850;padding:5px 9px;border-radius:999px}\n.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:15px 0 10px}\n.card{border:1px solid var(--line);border-radius:9px;padding:10px 11px}\n.card small{display:block;font-size:9px;text-transform:uppercase;color:var(--muted);font-weight:850}\n.card strong{font-size:17px;display:block;margin-top:2px}.card span{font-size:9px;color:var(--muted)}\n.dist-title{font-size:12px;font-weight:900;padding:9px 11px;background:#f4f7f8;border:1px solid var(--line);border-radius:9px 9px 0 0}\n.dist-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line);border-top:0;border-radius:0 0 9px 9px;overflow:hidden}\n.dist-card{padding:11px 14px;border-right:1px solid var(--line)}.dist-card:last-child{border-right:0}\n.dist-card b{display:block;font-size:12px}.dist-card strong{display:block;font-size:16px;color:#244d68;margin-top:2px}.dist-card small{font-size:9px;color:var(--muted)}\n.doctor-section{margin-top:22px}.doctor-head{display:flex;justify-content:space-between;align-items:end;padding:8px 10px;background:#f7fafb;border:1px solid var(--line);border-bottom:0;border-radius:9px 9px 0 0}\n.doctor-name{font-size:13px;font-weight:900}.doctor-sub{font-size:9px;color:var(--muted);margin-top:2px}\n.doctor-total{text-align:right}.doctor-total small{display:block;font-size:8px;text-transform:uppercase;color:var(--muted);font-weight:850}\n.doctor-total strong{font-size:15px;color:var(--brand);display:block}.doctor-total span{font-size:8px;color:var(--muted)}\ntable{width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid var(--line)}\nth{background:#f7f9fa;color:#5f6e75;font-size:8px;text-transform:uppercase;text-align:left;padding:7px 6px;border-bottom:1px solid var(--line);border-right:1px solid #e7ecee}\ntd{font-size:8.8px;padding:5px 6px;border-bottom:1px solid #edf1f2;border-right:1px solid #f0f3f4;vertical-align:top;line-height:1.27;overflow-wrap:anywhere}\ntbody tr:nth-child(even){background:#fcfdfd}.nf{font-weight:900;color:#174d64}\n.money{text-align:right;white-space:nowrap}.strong{font-weight:850}\n.doctor-value{background:#f1faf8;color:#0a625e;font-weight:850}.subtotal td{background:#f5f8f9;font-weight:900}\n.shared{display:inline-block;font-size:7px;background:#fff3d6;color:#805900;padding:2px 4px;border-radius:999px;margin-left:3px}\n.section-head{display:flex;justify-content:space-between;align-items:end;margin:15px 0 7px}\n.section-head h2{font-size:14px;margin:0}.section-head small{font-size:9px;color:var(--muted)}\n.partner{font-weight:800;color:#244d68}.missing{color:#8b969b;font-style:italic}\n.total-row td{background:#f1f6f7;font-weight:900;border-top:2px solid #cbd8dc}\n.status-title{margin-top:18px;padding:8px 10px;border:1px solid var(--line);border-bottom:0;border-radius:8px 8px 0 0;font-size:12px;font-weight:900}\n.cancel{background:#fff4f2;color:var(--red)}.replace{background:#fff8e8;color:var(--amber)}\n.soft-cancel{background:#fff9f8}.soft-replace{background:#fffaf3}\n.footer{display:flex;justify-content:space-between;margin-top:16px;padding-top:8px;border-top:1px solid var(--line);font-size:8px;color:#8b959a}\n.sn{font-weight:900;color:#9c6e19}.print-toolbar{position:sticky;top:0;z-index:30;display:flex;justify-content:space-between;align-items:center;padding:9px 22px;background:#10384b;color:white;font-size:12px}\n.print-toolbar button{padding:9px 16px;border:0;border-radius:6px;background:#e1f7f0;color:#0b5d59;font:inherit;font-weight:800;cursor:pointer}\n.insurance-section{margin-top:18px}.insurance-title{padding:9px 12px;background:#f4f7f8;border:1px solid var(--line);border-bottom:0;border-radius:8px 8px 0 0;font-weight:900;font-size:12px;color:#244d68}\n.empty{color:var(--muted);font-size:11px;padding:12px}\n.receipt-chart{margin-top:24px;padding-top:14px;border-top:2px solid var(--line)}\n.receipt-chart-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:5px;break-after:avoid}\n.receipt-chart-head h2{font-size:15px;margin:0}\n.receipt-chart-head strong{font-size:14px;color:var(--brand)}\n.receipt-chart-note{font-size:10px;color:var(--muted);margin-bottom:15px}\n.receipt-row{display:grid;grid-template-columns:minmax(160px,235px) minmax(100px,1fr) 135px;gap:13px;align-items:center;margin:9px 0;break-inside:avoid;page-break-inside:avoid}\n.receipt-label{font-size:11px;font-weight:800;overflow-wrap:anywhere}\n.receipt-track{height:20px;border-radius:6px;background:#edf3f4;overflow:hidden}\n.receipt-bar{display:block;height:100%;background:#0b7f79;border-radius:6px}\n.receipt-row.private .receipt-bar{background:#244d68}\n.receipt-money{text-align:right;font-size:11px;font-weight:850;font-variant-numeric:tabular-nums}\n.receipt-warning{font-size:9px;color:var(--amber);margin:11px 0 0}\n@media(max-width:1500px){.page{width:calc(100% - 24px);padding:20px;overflow-x:auto}}\n@media print{\n @page{size:A4 landscape;margin:7mm}\n body{background:#fff}.print-toolbar{display:none!important}\n .page{width:auto;margin:0;box-shadow:none;padding:0;overflow:visible}\n .page-break{break-before:page!important;page-break-before:always!important}\n thead{display:table-header-group}table{page-break-inside:auto}\n tr{break-inside:avoid;page-break-inside:avoid}\n .doctor-head{break-after:avoid;page-break-after:avoid}\n th,td{padding:3px 3.5px;font-size:6.8pt}\n}\n";
export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MONTH=/^\d{4}-(0[1-9]|1[0-2])$/;
const BRL=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"});
const esc=(v:unknown)=>String(v??"—").replace(/[&<>"']/g,c=>
 ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as Record<string,string>)[c]);
const amount=(v:unknown)=>v===null||v===undefined?"—":BRL.format(Number(v));
const date=(v:unknown)=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}/.test(v)?
 v.slice(8,10)+"/"+v.slice(5,7)+"/"+v.slice(0,4):"—";
const seq=new Intl.Collator("pt-BR",{numeric:true});
type Inv={id:string;invoice_number:string;payer:string|null;issue_date:string|null;
 paid_at:string|null;recipient_type:string;total_amount:number|null;net_amount:number|null;
 status:"ACTIVE"|"CANCELLED"|"REPLACED";replacement_invoice_number?:string|null};
type Doctor={professional_id:string;professional_name:string;attendances:number;
 charges:number;private_charges:number;insurance_charges:number;attributed_invoice_items:number};
type Attendance={attendance_id:string;billing_record_id:string;professional_id:string;
 professional_name:string;patient_name:string;procedure:string;service_date:string;
 payer_name:string;insurance_name?:string;billing_method:string;payment_status:string;no_invoice?:boolean;
 received_amount?:number|null;paid_at?:string|null;invoice_item_received?:number|null};
type Link={professional_id:string;invoice_id:string;attributed_amount?:number|null};
type Snapshot={entity:{name:string;trade_name:string|null;tax_id:string|null};
 competence:string;issued_invoices:{count:number;gross_total:number;net_total:number};
 professionals:Doctor[];professional_attendances?:Attendance[];
 professional_invoice_rows?:Link[];invoices:Inv[]};
const heading=(title:string,company:string,month:string,extra:string)=>
 '<div class="head"><div><div class="brand">RN INTEGRA</div><h1>'+esc(title)+
 '</h1><div class="company-name">'+esc(company)+'</div></div><div class="meta">'+
 '<span class="period">'+esc(month)+'</span><div>'+esc(extra)+'</div></div></div>';
const cell=(v:unknown,cls="")=>'<td'+(cls?' class="'+cls+'"':'')+'>'+esc(v)+'</td>';
const row=(data:Array<[unknown,string?]>,cls="")=>
 '<tr'+(cls?' class="'+cls+'"':'')+'>'+data.map(([v,c])=>cell(v,c)).join("")+'</tr>';
const table=(titles:string[],rows:string,percent?:number[])=>
 '<table>'+(percent?'<colgroup>'+percent.map(w=>'<col style="width:'+w+'%">').join("")+'</colgroup>':"")+
 '<thead><tr>'+titles.map(x=>'<th>'+esc(x)+'</th>').join("")+'</tr></thead><tbody>'+
 rows+'</tbody></table>';
const page=(contents:string,breakPage=false)=>'<section class="page'+(breakPage?' page-break':'')+'">'+contents+'</section>';
const period=(month:string)=>{const [y,m]=month.split("-").map(Number);
 return new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"})
 .format(new Date(Date.UTC(y,m-1,1))).toUpperCase();};
const statusClass=(status:Inv["status"])=>status==="CANCELLED"?"soft-cancel":status==="REPLACED"?"soft-replace":"";

export async function GET(request:Request){
 if(process.env.RN_MONTHLY_CLOSING_ENABLED!=="true")
  return Response.json({error:"Impressão não habilitada."},{status:404});
 const session=await getSession();
 if(!session||session.account.role!=="general_manager")
  return Response.json({error:"Acesso restrito ao Gerente Geral."},{status:403});
 const q=new URL(request.url).searchParams;
 const entity=q.get("entity_id")||"",month=q.get("month")||"",view=q.get("view")||"current";
 if(!UUID.test(entity)||!MONTH.test(month)||!["current","closed"].includes(view))
  return Response.json({error:"Parâmetros inválidos."},{status:400});
 try{
  const db=getSupabaseAdmin();
  const {data,error}=await db.rpc("get_billing_month_closing",{
   p_actor:session.account.id,p_entity:entity,p_month:month});
  if(error||!data)throw Error("Falha ao carregar fechamento");
  if(view==="closed"&&!data.closing)return Response.json({error:"Fechamento indisponível."},{status:400});
  const snap:Snapshot=(view==="closed"?data.closing.snapshot:data.current);
  const company=snap.entity.trade_name||snap.entity.name;
  const label=period(month);
  const invoices=[...(snap.invoices||[])].sort((a,b)=>seq.compare(a.invoice_number,b.invoice_number));
  const valid=invoices.filter(x=>x.status==="ACTIVE");
  const cancelled=invoices.filter(x=>x.status==="CANCELLED");
  const replaced=invoices.filter(x=>x.status==="REPLACED");
  const details=snap.professional_attendances||[];
  const links=snap.professional_invoice_rows||[];
  const ids=invoices.map(i=>i.id);
  // Apenas metadados associados às NFs e valores já presentes no fechamento.
  const userName=new Map<number,string>(),issuedBy=new Map<string,number>();
  const methodByInvoice=new Map<string,Set<string>>();
  if(ids.length){
   const inv=await db.from("invoices").select("id,created_by").in("id",ids);
   if(!inv.error){
    const invoiceActors: Array<{id:string;created_by:number|null}>=inv.data||[];
    const peopleIds=[...new Set(invoiceActors.map(x=>x.created_by).filter((x):x is number=>typeof x==="number"))];
    for(const i of invoiceActors)if(i.created_by)issuedBy.set(i.id,i.created_by);
    if(peopleIds.length){
     const people=await db.from("users").select("id,name").in("id",peopleIds);
     if(!people.error)for(const p of (people.data||[]) as Array<{id:number;name:string}>)userName.set(p.id,p.name);
    }
   }
   const payment=await db.from("payment_parts").select("invoice_id,method").in("invoice_id",ids);
   if(!payment.error)for(const part of (payment.data||[]) as Array<{invoice_id:string|null;method:string}>){
    if(!part.invoice_id)continue;
    const values=methodByInvoice.get(part.invoice_id)||new Set<string>();
    values.add(part.method);methodByInvoice.set(part.invoice_id,values);
   }
  }
  const methods=(id:string)=>{
   const map:Record<string,string>={PIX:"PIX",CREDIT_CARD:"Cartão de crédito",
    DEBIT_CARD:"Cartão de débito",CASH:"Dinheiro",BANK_TRANSFER:"Transferência",
    TRANSFER:"Transferência",CARD_CREDIT:"Cartão de crédito",CARD_DEBIT:"Cartão de débito"};
   return [...(methodByInvoice.get(id)||[])].map(m=>map[m]||m).join(" + ")||"Não informado";
  };
  const associations=new Map<string,string[]>();
  for(const link of links){
   const names=associations.get(link.invoice_id)||[];
   const d=snap.professionals.find(p=>p.professional_id===link.professional_id);
   if(d&&!names.includes(d.professional_name))names.push(d.professional_name);
   associations.set(link.invoice_id,names);
  }
  const referenced=new Map<string,string>();
  // O campo "Referente a" só usa procedimentos efetivamente relacionados.
  if(view==="current"&&ids.length){
   const lines=await db.from("invoice_billing_records")
     .select("invoice_id,billing_record_id").in("invoice_id",ids).eq("is_active",true);
   const invoiceItems: Array<{invoice_id:string;billing_record_id:string}>=lines.data||[];
   if(!lines.error&&invoiceItems.length){
    const values=[...new Set(invoiceItems.map(x=>x.billing_record_id))];
    const procByRecord=new Map<string,string>();
    for(const a of details)procByRecord.set(a.billing_record_id,a.procedure);
    for(const inv of ids){
     const proc=[...new Set(invoiceItems.filter(x=>x.invoice_id===inv)
       .map(x=>procByRecord.get(x.billing_record_id)).filter((x):x is string=>!!x))];
     if(proc.length)referenced.set(inv,proc.length===1?proc[0]:proc.join(" / "));
    }
   }
  }
  const totalCents=(items:Inv[],field:"total_amount"|"net_amount")=>
   items.reduce((sum,item)=>sum+Math.round(Number(item[field]||0)*100),0)/100;
  const card=(title:string,value:string,desc:string)=>
   '<div class="card"><small>'+esc(title)+'</small><strong>'+esc(value)+
   '</strong><span>'+esc(desc)+'</span></div>';
  const summary='<div class="summary">'+
   card("NFs válidas",String(valid.length),"Exclui canceladas/substituídas")+
   card("Valor bruto",amount(totalCents(valid,"total_amount")),"NFs válidas da relação")+
   card("Valor líquido",amount(totalCents(valid,"net_amount")),"NFs válidas da relação")+
   card("Ocorrências fiscais",String(cancelled.length+replaced.length),
    cancelled.length+" cancelada(s) · "+replaced.length+" substituída(s)")+'</div>';
  const assocs=(id:string)=>associations.get(id)?.join(" / ")||"—";
  const invoiceRow=(inv:Inv,allocated?:number|null)=>row([
   ["NFS-e "+inv.invoice_number+(inv.status==="ACTIVE"?"":" · "+monthlyInvoiceStatus(inv,invoices)),"nf"],[inv.payer||"—"],[date(inv.issue_date)],
   [date(inv.paid_at)],[amount(inv.total_amount),"money"],[amount(inv.net_amount),"money"],
   [allocated===undefined||allocated===null?"Não discriminado":amount(allocated),"money doctor-value"]
  ],statusClass(inv.status));
  const doctorTables=snap.professionals.map(doc=>{
   const items=invoices.filter(i=>links.some(l=>l.professional_id===doc.professional_id&&l.invoice_id===i.id));
   const sn=details.filter(a=>a.professional_id===doc.professional_id&&
    a.no_invoice&&a.payment_status==="PAGO");
   if(!items.length&&!sn.length)return "";
   const allocated=(i:Inv)=>{
    const l=links.find(l=>l.professional_id===doc.professional_id&&l.invoice_id===i.id);
    return l?.attributed_amount;
   };
   const docTotal=items.reduce((sum,i)=>sum+Math.round(Number(
    (i.status==="ACTIVE"?allocated(i):null)||0)*100),0)/100+
    sn.reduce((sum,a)=>sum+Math.round(Number(a.received_amount||0)*100),0)/100;
   const hasMissing=items.some(i=>i.status==="ACTIVE"&&allocated(i)==null);
   const result=items.map(i=>invoiceRow(i,allocated(i))).join("")+
    sn.map(a=>row([["S/N","sn"],[a.patient_name],[date(a.service_date)],
     [date(a.paid_at)],[amount(a.received_amount),"money"],
     [amount(a.received_amount),"money"],[amount(a.received_amount),"money doctor-value"]])).join("");
   return '<section class="doctor-section"><div class="doctor-head"><div><div class="doctor-name">'+
    esc(doc.professional_name)+'</div><div class="doctor-sub">'+
    esc("Notas vinculadas e recebimentos sem NF · "+doc.attendances+" atendimento(s)")+
    '</div></div><div class="doctor-total"><small>Valores discriminados neste relatório</small><strong>'+
    (hasMissing?"Ver discriminação":esc(amount(docTotal)))+
    '</strong><span>'+(hasMissing?"Alguns itens não possuem valor atribuído":"NFs válidas e S/N; sem duplicar a NF compartilhada")+
    '</span></div></div>'+
    table(["Nº NF","Pagador","Data emissão","Pagamento","Bruto da NF","Líquido da NF","Valor deste profissional"],
      result)+"</section>";
  }).filter(Boolean).join("");
  const distribution=snap.professionals.filter(d=>links.some(l=>l.professional_id===d.professional_id)&&
   links.some(l=>l.professional_id===d.professional_id&&l.attributed_amount!=null)).map(d=>{
    const subtotal=links.filter(l=>l.professional_id===d.professional_id &&
     invoices.some(i=>i.id===l.invoice_id&&i.status==="ACTIVE"))
     .reduce((s,l)=>s+Number(l.attributed_amount||0),0);
    return '<div class="dist-card"><b>'+esc(d.professional_name)+'</b><strong>'+
     esc(amount(subtotal))+'</strong><small>Itens de NFs discriminados no período</small></div>';
   }).join("");
  const allocation=distribution?'<div class="dist-title">VALORES DE NFs DISCRIMINADOS POR MÉDICO / PROFISSIONAL</div><div class="dist-grid">'+distribution+'</div>':"";
  const first=page(heading("Relatório mensal de Notas Fiscais",company,label,
   "Distribuição por médico / profissional · "+valid.length+" NFs válidas")+
   summary+allocation+doctorTables+
   '<div class="footer"><span>RN Integra · Distribuição por profissional</span><span>'+
   esc(view==="closed"?"Fechamento histórico preservado":"Posição atual")+"</span></div>");
  const validCols=["NF","Pagador","Referente a","Emissão","Pagamento",
   "Forma de pagamento","Valor bruto","Valor líquido","Sócio / Médico","Emitido por"];
  const validRows=valid.map(i=>row([
   ["NFS-e "+i.invoice_number,"nf"],[i.payer||"—"],
   [referenced.get(i.id)||"Não informado",referenced.has(i.id)?"":"missing"],
   [date(i.issue_date)],[date(i.paid_at)],[methods(i.id)],
   [amount(i.total_amount),"money"],[amount(i.net_amount),"money strong"],
   [assocs(i.id),"partner"],[userName.get(issuedBy.get(i.id)||0)||"—"]
  ])).join("");
  const second=page(heading("Lista de Notas Fiscais válidas",company,label,
    valid.length+" NFs válidas")+
    '<div class="section-head"><h2>NFs válidas</h2><small>Estrutura de 10 colunas</small></div>'+
    table(validCols,validRows+
     '<tr class="total-row"><td colspan="6">TOTAL DAS NFS VÁLIDAS</td>'+
     cell(amount(totalCents(valid,"total_amount")),"money")+
     cell(amount(totalCents(valid,"net_amount")),"money")+
     '<td colspan="2">'+esc(valid.length+" NFs válidas")+'</td></tr>',
     [6,14,15,8,8,14,9,9,10,7])+
     '<div class="footer"><span>RN Integra · NFs válidas</span><span>Relação por competência</span></div>',true);
  const occurrenceRows=(items:Inv[])=>table(validCols,items.map(i=>row([
   ["NFS-e "+i.invoice_number+" · "+monthlyInvoiceStatus(i,invoices),"nf"],[i.payer||"—"],
   [referenced.get(i.id)||"—"],[date(i.issue_date)],[date(i.paid_at)],
   [methods(i.id)],[amount(i.total_amount),"money"],[amount(i.net_amount),"money"],
   [assocs(i.id)],[userName.get(issuedBy.get(i.id)||0)||"—"]
  ],statusClass(i.status))).join(""),[6,14,15,8,8,14,9,9,10,7]);
  const third=cancelled.length||replaced.length?page(
   heading("Ocorrências fiscais do período",company,label,"NFs canceladas e substituídas")+
   (cancelled.length?'<div class="status-title cancel">NFS CANCELADAS — FORA DOS TOTAIS E DISTRIBUIÇÃO</div>'+
     occurrenceRows(cancelled):"")+
   (replaced.length?'<div class="status-title replace">NFS SUBSTITUÍDAS — PRESERVADAS NO HISTÓRICO</div>'+
     occurrenceRows(replaced):"")+
   '<div class="footer"><span>RN Integra · Ocorrências fiscais</span>'+
   '<span>Histórico preservado</span></div>',true):"";
  // Convênios: lista única, independente do bloco de NFs por profissional.
  // Nunca deduz valor pago de uma NF inteira: só apresenta alocação individual.
  const insurance=details.filter(a=>a.billing_method==="CONVENIO");
  const groups=new Map<string,Attendance[]>();
  for(const a of insurance){
   const key=a.insurance_name?.trim()||a.payer_name?.trim()||"Convênio não informado";
   const list=groups.get(key)||[];list.push(a);groups.set(key,list);
  }
  const insuranceBlocks=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],"pt-BR"))
   .map(([name,items])=>{
    const sorted=[...items].sort((a,b)=>a.service_date.localeCompare(b.service_date)||
      a.patient_name.localeCompare(b.patient_name,"pt-BR"));
    return '<div class="insurance-section"><div class="insurance-title">'+esc(name)+
     ' · '+items.length+' cobrança(s)</div>'+
     table(["Paciente","Procedimento","Atendimento","Valor pago","Médico responsável"],
      sorted.map(a=>row([[a.patient_name],[a.procedure||"—"],[date(a.service_date)],
        [a.payment_status==="PAGO"?amount(a.invoice_item_received??a.received_amount):"Pendente","money"],
        [a.professional_name]])).join(""),[25,29,13,15,18])+"</div>";
   }).join("");
  // Valores por atendimento realizado nesta competência, sem ratear o total de NFs.
  // A seção permanece na mesma página lógica de "Atendimentos por convênio".
  const comparison=monthlyReceiptComparison(details);
  const greatest=Math.max(1,...comparison.groups.map(item=>item.receivedCents));
  const receiptRows=comparison.groups.map((item,index)=>{
   const percentage=(item.receivedCents/greatest*100).toFixed(2);
   return '<div class="receipt-row'+(index===0?' private':'')+'"><span class="receipt-label">'+
    esc(item.label)+'</span><div class="receipt-track"><span class="receipt-bar" style="width:'+
    percentage+'%"></span></div><span class="receipt-money">'+
    esc(amount(item.receivedCents/100))+'</span></div>';
  }).join("");
  const receiptChart='<div class="receipt-chart"><div class="receipt-chart-head">'+
   '<h2>Recebimentos por origem</h2><strong>Total: '+
   esc(amount(comparison.totalCents/100))+'</strong></div>'+
   '<div class="receipt-chart-note">Particular e cada convênio separadamente · '+
   'Somente valores pagos e individualizados dos atendimentos desta competência '+
   '(data do atendimento, não necessariamente do depósito).</div>'+
   receiptRows+
   (comparison.missingPaidAmounts?
     '<p class="receipt-warning">'+comparison.missingPaidAmounts+
     ' cobrança(s) paga(s) sem valor individualizado foram excluídas dos totais.</p>':"")+
   '</div>';
  const fourth=page(heading("Atendimentos por convênio",company,label,
   "Todos os médicos · "+insurance.length+" cobrança(s)")+
   (insuranceBlocks||'<div class="empty">Nenhum atendimento por convênio nesta competência.</div>')+
   receiptChart+
   '<div class="footer"><span>RN Integra · Atendimentos por convênio</span>'+
   '<span>Valores individuais disponíveis</span></div>',true);
  const nonce=randomBytes(16).toString("base64");
  const js="const b=document.getElementById('print');if(b)b.addEventListener('click',()=>window.print());"+
   "window.addEventListener('load',()=>setTimeout(()=>window.print(),350));";
  const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'+
   '<meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<title>RN Integra · '+esc(label)+' · Relatório mensal</title><style>'+CSS+
   '</style></head><body><div class="print-toolbar"><span>RN Integra · Impressão '+esc(label)+
   '</span><button type="button" id="print">Imprimir / Salvar PDF</button></div>'+
   first+second+third+fourth+'<script nonce="'+nonce+'">'+js+'</script></body></html>';
  return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8",
   "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
   "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+
     "'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
 }catch{
  return Response.json({error:"Não foi possível preparar a impressão mensal."},{status:503});
 }
}
