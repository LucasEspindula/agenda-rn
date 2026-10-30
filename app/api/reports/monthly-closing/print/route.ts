import {randomBytes} from "node:crypto";
import {getSession} from "@/app/authz";
import {getSupabaseAdmin} from "@/lib/supabase-admin";
import {financialActorOrganizationId} from "@/lib/financial-organization";
import {monthlyInvoiceStatus} from "@/lib/monthly-invoice-status";
import {monthlyReceiptComparison} from "@/lib/monthly-receipt-comparison";

const CSS="\n:root{--ink:#172126;--muted:#66747b;--line:#dfe5e8;--brand:#0b7f79;--red:#b42318;--amber:#8a5b00;--warnbg:#fff8e8}\n*{box-sizing:border-box}body{margin:0;background:#edf1f3;font-family:Inter,Segoe UI,Arial,sans-serif;color:var(--ink)}\n.page{width:1480px;margin:22px auto;background:#fff;padding:28px 30px 34px;box-shadow:0 8px 24px rgba(0,0,0,.07)}\n.page-break{break-before:page;page-break-before:always}\n.head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #d8e1e5;padding-bottom:14px}\n.brand{font-size:12px;font-weight:850;color:var(--brand);letter-spacing:.04em}\nh1{font-size:24px;margin:4px 0 3px}.company-name{font-size:14px;font-weight:750}\n.meta{text-align:right;color:var(--muted);font-size:11px;line-height:1.6}\n.period{display:inline-block;background:#e9f6f4;color:var(--brand);font-weight:850;padding:5px 9px;border-radius:999px}\n.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:15px 0 10px}\n.card{border:1px solid var(--line);border-radius:9px;padding:10px 11px}\n.card small{display:block;font-size:9px;text-transform:uppercase;color:var(--muted);font-weight:850}\n.card strong{font-size:17px;display:block;margin-top:2px}.card span{font-size:9px;color:var(--muted)}\n.dist-title{font-size:12px;font-weight:900;padding:9px 11px;background:#f4f7f8;border:1px solid var(--line);border-radius:9px 9px 0 0}\n.dist-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line);border-top:0;border-radius:0 0 9px 9px;overflow:hidden}\n.dist-card{padding:11px 14px;border-right:1px solid var(--line)}.dist-card:last-child{border-right:0}\n.dist-card b{display:block;font-size:12px}.dist-card strong{display:block;font-size:16px;color:#244d68;margin-top:2px}.dist-card small{font-size:9px;color:var(--muted)}\n.doctor-section{margin-top:22px}.doctor-head{display:flex;justify-content:space-between;align-items:end;padding:8px 10px;background:#f7fafb;border:1px solid var(--line);border-bottom:0;border-radius:9px 9px 0 0}\n.doctor-name{font-size:13px;font-weight:900}.doctor-sub{font-size:9px;color:var(--muted);margin-top:2px}\n.doctor-total{text-align:right}.doctor-total small{display:block;font-size:8px;text-transform:uppercase;color:var(--muted);font-weight:850}\n.doctor-total strong{font-size:15px;color:var(--brand);display:block}.doctor-total span{font-size:8px;color:var(--muted)}\ntable{width:100%;border-collapse:collapse;table-layout:fixed;border:1px solid var(--line)}\nth{background:#f7f9fa;color:#5f6e75;font-size:8px;text-transform:uppercase;text-align:left;padding:7px 6px;border-bottom:1px solid var(--line);border-right:1px solid #e7ecee}\ntd{font-size:8.8px;padding:5px 6px;border-bottom:1px solid #edf1f2;border-right:1px solid #f0f3f4;vertical-align:top;line-height:1.27;overflow-wrap:anywhere}\ntbody tr:nth-child(even){background:#fcfdfd}.nf{font-weight:900;color:#174d64}\n.money{text-align:right;white-space:nowrap}.strong{font-weight:850}\n.doctor-value{background:#f1faf8;color:#0a625e;font-weight:850}.subtotal td{background:#f5f8f9;font-weight:900}\n.shared{display:inline-block;font-size:7px;background:#fff3d6;color:#805900;padding:2px 4px;border-radius:999px;margin-left:3px}\n.section-head{display:flex;justify-content:space-between;align-items:end;margin:15px 0 7px;break-after:avoid-page;page-break-after:avoid}\n.section-head h2{font-size:14px;margin:0}.section-head small{font-size:9px;color:var(--muted)}\n.partner{font-weight:800;color:#244d68}.missing{color:#8b969b;font-style:italic}\n.total-row td{background:#f1f6f7;font-weight:900;border-top:2px solid #cbd8dc}\n.status-title{margin-top:18px;padding:8px 10px;border:1px solid var(--line);border-bottom:0;border-radius:8px 8px 0 0;font-size:12px;font-weight:900}\n.cancel{background:#fff4f2;color:var(--red)}.replace{background:#fff8e8;color:var(--amber)}\n.soft-cancel{background:#fff9f8}.soft-replace{background:#fffaf3}\n.footer{display:flex;justify-content:space-between;margin-top:16px;padding-top:8px;border-top:1px solid var(--line);font-size:8px;color:#8b959a}\n.sn{font-weight:900;color:#9c6e19}.print-toolbar{position:sticky;top:0;z-index:30;display:flex;justify-content:space-between;align-items:center;padding:9px 22px;background:#10384b;color:white;font-size:12px}\n.print-toolbar button{padding:9px 16px;border:0;border-radius:6px;background:#e1f7f0;color:#0b5d59;font:inherit;font-weight:800;cursor:pointer}\n.insurance-section{margin-top:18px}.insurance-title{padding:9px 12px;background:#f4f7f8;border:1px solid var(--line);border-bottom:0;border-radius:8px 8px 0 0;font-weight:900;font-size:12px;color:#244d68}\n.empty{color:var(--muted);font-size:11px;padding:12px}\n.attendance-heading{font-size:13px;font-weight:850;margin:19px 0 7px;color:#244d68;break-after:avoid}\n.attendance-note{font-size:10px;color:var(--muted);margin:12px 0}\n.attendance-cancelled tbody tr{background:#fff9f5}\n.receipt-chart{margin-top:24px;padding-top:14px;border-top:2px solid var(--line)}\n.receipt-chart-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:5px;break-after:avoid}\n.receipt-chart-head h2{font-size:15px;margin:0}\n.receipt-chart-head strong{font-size:14px;color:var(--brand)}\n.receipt-chart-note{font-size:10px;color:var(--muted);margin-bottom:12px}\n.receipt-plot{display:block;width:100%;max-width:1150px;height:auto;margin:0 auto 12px;break-inside:avoid;page-break-inside:avoid}\n.receipt-warning{font-size:9px;color:var(--amber);margin:11px 0 0}\n.finance-notices{margin:8px 0;padding-left:20px;color:var(--amber);font-size:10px;line-height:1.5}\n.finance-notices li{margin:3px 0;break-inside:avoid}\n.glosa-summary{break-inside:avoid-page;page-break-inside:avoid}\n.doctor-note{font-size:9px;color:var(--muted);margin:7px 0 10px}\n@media(max-width:1500px){.page{width:calc(100% - 24px);padding:20px;overflow-x:auto}}\n.print-watermark{display:none}\n@media print{\n .print-watermark{display:block!important;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-32deg);font-size:62pt;font-weight:900;letter-spacing:.09em;white-space:nowrap;color:rgba(39,80,105,.12);pointer-events:none;user-select:none;z-index:20}\n @page{size:A4 landscape;margin:7mm}\n body{background:#fff}.print-toolbar{display:none!important}\n .page{width:auto;margin:0;box-shadow:none;padding:0;overflow:visible}\n .page-break{break-before:page!important;page-break-before:always!important}\n thead{display:table-header-group}table{page-break-inside:auto}\n tr{break-inside:avoid;page-break-inside:avoid}\n .doctor-head{break-after:avoid;page-break-after:avoid}\n th,td{padding:3px 3.5px;font-size:6.8pt}\n}\n";
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
type Link={professional_id:string;professional_name?:string;invoice_id:string;attributed_amount?:number|null;patient_names?:string[];billing_record_ids?:string[]};
type PaidUnrealized={billing_record_id:string;attendance_id:string;service_date:string;clinical_status:string;
 patient_name:string;professional_name:string;procedure:string;billing_method:string;received_amount:number|null;
 paid_at:string;insurance_name:string};
type MonthlyAttendance={attendance_id:string;service_date:string;status:"realized"|"cancelled";
 patient_name:string;professional_name:string;procedure:string;billing_method:string;
 insurance_name:string;cancelled_at?:string|null;cancellation_reason?:string|null};
type Snapshot={entity:{name:string;trade_name:string|null;tax_id:string|null};
 competence:string;issued_invoices:{count:number;gross_total:number;net_total:number;without_net_amount?:number};
 professionals:Doctor[];professional_attendances?:Attendance[];
 attendance_overview?:MonthlyAttendance[];
 paid_unrealized?:PaidUnrealized[];
 cash?:{direct_received:number;insurance_invoice_received:number;insurance_paid_invoices_without_net?:number};
 expenses?:{competence_total:number;paid_total:number};
 expense_items?:Array<{id:string;description:string;category:string;competence_date:string;
   paid_at:string|null;amount:number;status:string}>;
 direct_payments?:Array<{id:string;professional_id?:string|null;professional_name:string;patient_name?:string;paid_at:string;
   received_amount:number|null;billing_method:string}>;
 denials?:{denied_in_month:number;recovered_in_month:number;loss_on_cases_opened_in_month_now:number};
 denial_items?:Array<{id:string;denied_on:string;denial_kind:string;reason:string;
   denied_amount:number;recovered_amount:number;status:string}>;
 pending_now?:{unpaid_invoice_count:number;unpaid_invoice_net:number;unpaid_invoice_unknown_net:number};
 production?:{attendances:number;charges:number;pending_charges_now:number;unpriced_charges:number};
 notices?:string[];
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


type ReceiptBar={label:string;receivedCents:number};
// Gráfico SVG vetorial, sem dependência de Canvas: legível ao imprimir ou salvar em PDF.
// Quando existem muitos convênios, distribui as colunas em painéis com a MESMA escala.
function receiptChartSvg(groups:ReadonlyArray<ReceiptBar>):string{
 const max=Math.max(100,...groups.map(item=>item.receivedCents));
 const rough=max/4,scale=Math.pow(10,Math.floor(Math.log10(rough)));
 const unit=[1,2,2.5,5,10].find(value=>value*scale>=rough)||10;
 const tick=Math.round(unit*scale),topValue=tick*4;
 const width=900,left=112,right=24,top=55,bottom=255;
 const axisMoney=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL",
  notation:"compact",maximumFractionDigits:1});
 const wrapName=(name:string,limit:number):string[]=>{
  const parts:string[]=[];
  let current="";
  for(const word of name.trim().split(/\s+/)){
   if(!word)continue;
   if((current?current.length+1:0)+word.length<=limit){
    current=current?current+" "+word:word;continue;
   }
   if(current){parts.push(current);current=""}
   if(word.length>limit){
    for(let start=0;start<word.length;start+=limit)parts.push(word.slice(start,start+limit));
   }else current=word;
  }
  if(current)parts.push(current);
  return parts.length?parts:["—"];
 };
 const panels:string[]=[];
 for(let offset=0;offset<groups.length;offset+=8){
  const items=groups.slice(offset,offset+8);
  const slot=(width-left-right)/items.length;
  const names=items.map(item=>wrapName(item.label,Math.max(11,Math.min(20,Math.floor(slot/8)))));
  const height=bottom+35+Math.max(1,...names.map(lines=>lines.length))*17+10;
  const ticks=[0,1,2,3,4].map(n=>{
   const y=bottom-n*(bottom-top)/4;
   return '<line x1="'+left+'" y1="'+y+'" x2="'+(width-right)+'" y2="'+y+
    '" stroke="'+(n===0?'#a9b7be':'#e6ecef')+'" stroke-width="'+(n===0?'1.5':'1')+'"/>'+
    '<text x="'+(left-13)+'" y="'+(y+4)+'" text-anchor="end" fill="#66747b" font-size="11">'+
    esc(axisMoney.format(n*tick/100))+'</text>';
  }).join("");
  const bars=items.map((item,i)=>{
   const x=left+slot*(i+.5),barWidth=Math.min(78,slot*.62);
   const barHeight=item.receivedCents/topValue*(bottom-top);
   const y=bottom-barHeight;
   const name=names[i].map((line,lineIndex)=>'<tspan x="'+x+'" dy="'+
    (lineIndex?17:0)+'">'+esc(line)+'</tspan>').join("");
   return '<g><title>'+esc(item.label+" — "+amount(item.receivedCents/100))+'</title>'+
    '<rect x="'+(x-barWidth/2)+'" y="'+y+'" width="'+barWidth+'" height="'+barHeight+
    '" fill="'+(offset+i===0?'#244d68':'#17857f')+'" rx="2"/>'+
    '<text x="'+x+'" y="'+Math.max(27,y-10)+'" text-anchor="middle" font-size="12" font-weight="700" fill="#172126">'+
    esc(amount(item.receivedCents/100))+'</text>'+
    '<text x="'+x+'" y="'+(bottom+24)+'" text-anchor="middle" font-size="12" font-weight="650" fill="#172126">'+
    name+'</text></g>';
  }).join("");
  panels.push('<svg class="receipt-plot" xmlns="http://www.w3.org/2000/svg" '+
   'viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Recebimentos por origem, gráfico de colunas">'+
   '<title>Recebimentos por origem</title>'+
   '<text transform="translate(21 '+((top+bottom)/2)+') rotate(-90)" text-anchor="middle" '+
   'font-size="12" fill="#66747b">Valor recebido (R$)</text>'+
   ticks+'<line x1="'+left+'" y1="'+top+'" x2="'+left+'" y2="'+bottom+
   '" stroke="#a9b7be" stroke-width="1.5"/>'+bars+'</svg>');
 }
 return panels.join("");
}

export async function GET(request:Request){
 if(process.env.RN_MONTHLY_CLOSING_ENABLED!=="true")
  return Response.json({error:"Impressão não habilitada."},{status:404});
 const session=await getSession();
 if(!session||session.account.role!=="general_manager")
  return Response.json({error:"Acesso restrito ao Gerente Geral."},{status:403});
 const organizationId=await financialActorOrganizationId(session.account.id);
 if(!organizationId)return Response.json({error:"Acesso à organização negado."},{status:403});
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
  const details=snap.professional_attendances||[];
  const links=snap.professional_invoice_rows||[];
  const card=(title:string,value:string,desc:string)=>
   '<div class="card"><small>'+esc(title)+'</small><strong>'+esc(value)+
   '</strong><span>'+esc(desc)+'</span></div>';

  // Distribuição de recebimentos: chave sempre pelo ID histórico do médico.
  // A NF compartilhada mostra seu líquido inteiro, mas somente o item discriminado
  // é atribuído ao profissional. Não se faz rateio presumido.
  type DoctorGroup={id:string;name:string;
   notes:Array<{invoice:Inv;value:number|null;patientNames:string[];recordIds:string[]}>;
   payments:Array<{id:string;paid_at:string;billing_method:string;received_amount:number|null;patient_name:string}>;
   directCents:number;insurerCents:number;missing:boolean};
  const doctors=new Map<string,DoctorGroup>();
  const profName=new Map(snap.professionals.map(d=>[d.professional_id,d.professional_name]));
  const getDoctor=(id:string,name:string)=>{
   const key=id||"sem-vinculo:"+name;
   if(!doctors.has(key))doctors.set(key,{id:key,name:name||"Profissional não identificado",
    notes:[],payments:[],directCents:0,insurerCents:0,missing:false});
   return doctors.get(key)!;
  };
  const toCents=(n:unknown):number|null=>{
   if(n===null||n===undefined||n==="")return null;
   const number=Number(n);return Number.isFinite(number)&&number>=0?Math.round(number*100):null;
  };
  const directIds=new Set<string>();
  const detailByRecord=new Map(details.map(a=>[a.billing_record_id,a]));
  const unpaidDetail=new Map((snap.paid_unrealized||[]).map(a=>[a.billing_record_id,a]));
  for(const p of snap.direct_payments||[]){
   if(!p.id||directIds.has(p.id))continue;
   directIds.add(p.id);
   let id=p.professional_id||"";const name=profName.get(id)||p.professional_name||"Profissional não identificado";
   if(!id){
    const alternatives=snap.professionals.filter(x=>x.professional_name===name);
    if(alternatives.length===1)id=alternatives[0].professional_id;
   }
   const g=getDoctor(id,name),received=toCents(p.received_amount);
   if(received===null)g.missing=true;else g.directCents+=received;
   const patient=(p.patient_name||detailByRecord.get(p.id)?.patient_name||
    unpaidDetail.get(p.id)?.patient_name||"Referência não disponível");
   g.payments.push({id:p.id,paid_at:p.paid_at,billing_method:p.billing_method,
    received_amount:p.received_amount,patient_name:patient});
  }
  const invoiced=new Map(invoices.map(i=>[i.id,i]));
  const seenLinks=new Set<string>();
  for(const l of links){
   const inv=invoiced.get(l.invoice_id);
   if(!inv||!l.professional_id)continue;
   const key=l.professional_id+"::"+l.invoice_id;
   if(seenLinks.has(key))continue;
   seenLinks.add(key);
   const g=getDoctor(l.professional_id,profName.get(l.professional_id)||
    l.professional_name||"Profissional histórico");
   const patientNames=[...new Set((l.patient_names||[]).filter(Boolean))];
   for(const billingId of l.billing_record_ids||[]){
    const d=detailByRecord.get(billingId)||unpaidDetail.get(billingId);
    if(d?.patient_name&&!patientNames.includes(d.patient_name))patientNames.push(d.patient_name);
   }
   const itemCents=toCents(l.attributed_amount);
   // Caixa do convênio somente na data do pagamento da NF, e sem duplicar o total.
   if(inv.status==="ACTIVE"&&inv.recipient_type==="CONVENIO"&&
     inv.paid_at?.slice(0,7)===month){
    if(itemCents===null)g.missing=true;else g.insurerCents+=itemCents;
   }
   g.notes.push({invoice:inv,value:itemCents===null?null:itemCents/100,
    patientNames,recordIds:l.billing_record_ids||[]});
  }
  const seenInvoices=new Set(links.map(l=>l.invoice_id));
  const doctorTables=[...doctors.values()].sort((a,b)=>
   a.name.localeCompare(b.name,"pt-BR")||a.id.localeCompare(b.id)).map(g=>{
   const matchedPayments=new Set<string>();
   const nfRows=g.notes.map(l=>{
    const inv=l.invoice,privateNF=inv.recipient_type==="PARTICULAR";
    // Pagamento direto ligado à NF particular pertence ao mesmo lançamento,
    // portanto aparece nesta linha e não de novo em Recebimentos individuais.
    const used=privateNF?g.payments.filter(p=>l.recordIds.includes(p.id)&&!matchedPayments.has(p.id)):[];
    for(const payment of used){
     matchedPayments.add(payment.id);
     if(payment.patient_name!=="Referência não disponível"&&
       !l.patientNames.includes(payment.patient_name))l.patientNames.push(payment.patient_name);
    }
    const paidDirect=used.reduce((s,p)=>s+(toCents(p.received_amount)||0),0);
    const attributable=used.length?paidDirect/100:l.value;
    return row([["NF "+inv.invoice_number,"nf"],[inv.payer||"—"],
      [l.patientNames.join(" / ")||"Sem paciente discriminado no snapshot"],
      [date(inv.issue_date)],[date(inv.paid_at)],[amount(inv.net_amount),"money"],
      [amount(attributable),"money doctor-value"],
      [privateNF?"Particular":"Convênio"],[monthlyInvoiceStatus(inv,invoices)]
    ],statusClass(inv.status));
   }).join("");
   const directRows=g.payments.filter(p=>!matchedPayments.has(p.id)).map(p=>row([
     ["Direto / S/N","sn"],[p.billing_method==="PARTICULAR"?"Particular":"Direto"],
     [p.patient_name],["—"],[date(p.paid_at)],["—"],
     [amount(p.received_amount),"money doctor-value"],["Particular"],["Pago"]
   ])).join("");
   const total=(g.directCents+g.insurerCents)/100;
   return '<section class="doctor-section"><div class="doctor-head"><div>'+
    '<div class="doctor-name">'+esc(g.name)+'</div>'+
    '<div class="doctor-sub">Direto: '+esc(amount(g.directCents/100))+
    ' · Convênios atribuídos e pagos: '+esc(amount(g.insurerCents/100))+
    '</div></div><div class="doctor-total"><small>Recebido neste mês</small>'+
    '<strong>'+esc(amount(total))+(g.missing?" (parcial)":"")+'</strong></div></div>'+
     table(["Documento","Pagador / origem","Paciente / referência","Emissão",
     "Pagamento","NF líquida total","Valor deste médico","Tipo","Status"],
     nfRows+directRows,[11,12,19,10,10,12,12,7,7])+
    '</section>';
  }).join("");
  // NFs não vinculadas permanecem visíveis, sem inventar uma divisão por sócio.
  const noDoctorInvoices=invoices.filter(i=>!seenInvoices.has(i.id));
  const unlinkedNotes=noDoctorInvoices.length?
   '<div class="section-head"><h2>NFs sem vínculo por médico</h2>'+
   '<small>Sem valor atribuído automaticamente</small></div>'+
   table(["NF","Pagador","Emissão","Pagamento","Líquido total","Status"],
    noDoctorInvoices.map(i=>row([["NF "+i.invoice_number,"nf"],[i.payer||"—"],
     [date(i.issue_date)],[date(i.paid_at)],[amount(i.net_amount),"money"],
     [monthlyInvoiceStatus(i,invoices)]],statusClass(i.status))).join(""),
    [12,28,15,15,15,15]):"";
  // Valores por atendimento realizado nesta competência, sem ratear o total de NFs.
  // A seção permanece na mesma página lógica de "Atendimentos por convênio".
  const extraPaid=(snap.paid_unrealized||[]).map(p=>({
   billing_method:p.billing_method,payment_status:"PAGO",insurance_name:p.insurance_name,
   received_amount:p.received_amount
  }));
  const comparison=monthlyReceiptComparison([...details,...extraPaid]);
  const receiptColumns=receiptChartSvg(comparison.groups);
  const receiptChart='<div class="receipt-chart"><div class="receipt-chart-head">'+
   '<h2>Comparativo de recebimentos</h2><strong>Total: '+
   esc(amount(comparison.totalCents/100))+'</strong></div>'+
   '<div class="receipt-chart-note">Particular e cada convênio separadamente · '+
   'Somente valores pagos e individualizados dos atendimentos desta competência '+
   '(data do atendimento, não necessariamente do depósito).</div>'+
   receiptColumns+
   (comparison.missingPaidAmounts?
     '<p class="receipt-warning">'+comparison.missingPaidAmounts+
     ' cobrança(s) paga(s) sem valor individualizado foram excluídas dos totais.</p>':"")+
   '</div>';
  const receiptChartPage=page(heading("Recebimentos por origem",company,label,
   "Particular e convênios · somente recebimentos confirmados")+
   receiptChart+
   '<div class="footer"><span>RN Integra · Recebimentos por origem</span>'+
   '<span>Comparativo financeiro da competência</span></div>',true);
  // A relação clínica não depende de cobrança: um atendimento pode ter vários itens.
  // Fechamentos antigos não contêm cancelamentos; nunca inferi-los da posição atual.
  const legacyOverview:MonthlyAttendance[]=[...new Map<string,MonthlyAttendance>(details.map(a=>[a.attendance_id,{
   attendance_id:a.attendance_id,service_date:a.service_date,status:"realized" as const,
   patient_name:a.patient_name,professional_name:a.professional_name,procedure:a.procedure,
   billing_method:a.billing_method,insurance_name:a.insurance_name||a.payer_name
  }])).values()];
  const attendanceOverview=snap.attendance_overview||legacyOverview;
  const performed=attendanceOverview.filter(a=>a.status==="realized").sort((a,b)=>
   a.service_date.localeCompare(b.service_date)||a.patient_name.localeCompare(b.patient_name,"pt-BR"));
  const cancellations=attendanceOverview.filter(a=>a.status==="cancelled").sort((a,b)=>
   a.service_date.localeCompare(b.service_date)||a.patient_name.localeCompare(b.patient_name,"pt-BR"));
  const payer=(a:MonthlyAttendance)=>a.billing_method==="PARTICULAR"?"Particular":
   a.insurance_name||"Convênio não informado";
  const fulfilledRows=performed.map(a=>row([
   [a.patient_name],[date(a.service_date)],[a.procedure||"—"],
   [payer(a)],[a.professional_name]
  ])).join("");
  const cancellationRows=cancellations.map(a=>row([
   [a.patient_name],[date(a.service_date)],[a.procedure||"—"],
   [payer(a)],[a.professional_name],[date(a.cancelled_at)],[a.cancellation_reason||"—"]
  ])).join("");
  const paidUnrealized=snap.paid_unrealized||[];
  const paidUnrealizedRows=paidUnrealized.map(p=>row([
   [p.patient_name],[date(p.service_date)],[p.procedure||"—"],[p.professional_name],
   [p.clinical_status],[date(p.paid_at)],[amount(p.received_amount),"money"]
  ])).join("");
  const attendancePage=page(heading("Relatório de Fechamento Mensal",company,label,
   performed.length+" realizado(s) · "+
   (snap.attendance_overview?cancellations.length+" cancelado(s)":"Cancelamentos não disponíveis neste histórico"))+
   '<div class="section-head"><h2>Atendimentos da competência</h2>'+
   '<small>Relação assistencial · separada dos documentos fiscais</small></div>'+
   '<p class="attendance-note">Uma linha por atendimento, por data prevista/realizada. '+
   'Cancelamentos não entram na produção realizada nem nos recebimentos.</p>'+
   '<div class="attendance-heading">ATENDIMENTOS REALIZADOS ('+performed.length+')</div>'+
   (performed.length?table(["Paciente","Atendimento","Procedimento","Convênio / cobrança","Médico responsável"],
    fulfilledRows,[23,12,26,17,22]):'<div class="empty">Nenhum atendimento realizado nesta competência.</div>')+
   (cancellations.length?'<div class="attendance-heading">ATENDIMENTOS CANCELADOS ('+
    cancellations.length+')</div><div class="attendance-cancelled">'+
    table(["Paciente","Data prevista","Procedimento","Convênio / cobrança","Médico responsável","Cancelado em","Motivo"],
     cancellationRows,[17,10,19,16,15,10,13])+'</div>':"")+
   (paidUnrealized.length?'<div class="attendance-heading">PAGOS SEM REALIZAÇÃO CONFIRMADA ('+
    paidUnrealized.length+')</div><p class="attendance-note">Entram no caixa por pagamento, mas NÃO na produção realizada. Confira o status na Agenda.</p>'+
    table(["Paciente","Atendimento","Procedimento","Médico","Status clínico","Pago em","Recebido"],
     paidUnrealizedRows,[16,11,20,16,12,10,15]):"")+
   (!snap.attendance_overview?'<p class="attendance-note">Fechamento anterior à inclusão '+
    'do histórico de cancelamentos. A posição atual não foi usada para alterar o histórico.</p>':"")+
   '<div class="footer"><span>RN Integra · Relação de atendimentos</span><span>'+
   esc(view==="closed"?"Fechamento histórico preservado":"Posição atual")+'</span></div>');
  // Esta seção utiliza as mesmas medidas financeiras e listas da tela do fechamento.
  // Competência (data de referência) e fluxo de caixa (data de pagamento) não se confundem.
  const expenseItems=[...(snap.expense_items||[])].sort((a,b)=>
   a.competence_date.localeCompare(b.competence_date)||a.description.localeCompare(b.description,"pt-BR"));
  const expenseRows=expenseItems.map(e=>row([
   [e.description],[e.category||"—"],[date(e.competence_date)],[date(e.paid_at)],
   [e.status],[amount(e.amount),"money"]
  ])).join("");
  const denialItems=[...(snap.denial_items||[])].sort((a,b)=>
   String(a.denied_on||"").localeCompare(String(b.denied_on||"")));
  const denialRows=denialItems.map(g=>row([
   [date(g.denied_on)],[g.denial_kind],[g.reason],
   [amount(g.denied_amount),"money"],[amount(g.recovered_amount),"money"],[g.status]
  ])).join("");
  const directAmount=snap.cash?.direct_received??null;
  const insuranceAmount=snap.cash?.insurance_invoice_received??null;
  const expensePaid=snap.expenses?.paid_total??null;
  const receiptTotal=directAmount===null||insuranceAmount===null?null:
   (Math.round(Number(directAmount)*100)+Math.round(Number(insuranceAmount)*100))/100;
  const cashResult=receiptTotal===null||expensePaid===null?null:
   (Math.round(receiptTotal*100)-Math.round(Number(expensePaid)*100))/100;
  const incomeCards='<div class="summary">'+
   card("Recebimentos particulares",amount(directAmount),"")+
   card("Convênios recebidos",amount(insuranceAmount),"")+
   card("Entradas em caixa",amount(receiptTotal),"")+
   '</div>';
  const expenseCards='<div class="summary">'+
   card("Despesas pagas",amount(expensePaid),"")+
   card("Despesas da competência",amount(snap.expenses?.competence_total),"")+
   card("Resultado de caixa",amount(cashResult),"")+
   '</div>';
  const pending=snap.pending_now;
  const denials=snap.denials;
  const combinedFinancePage=page(heading("Divisão por Sócio / Médico e Caixa",company,label,
   "Recebimentos por médico")+
   '<div class="section-head"><h2>Resumo de recebimentos</h2></div>'+
   incomeCards+
   '<div class="section-head"><h2>Divisão por sócio / médico</h2></div>'+
   (doctorTables||'<div class="empty">Nenhum recebimento atribuído a profissionais.</div>')+
   unlinkedNotes+
   '<div class="footer"><span>RN Integra · Caixa por médico</span></div>',true);
  const glosaSummary='<div class="glosa-summary">'+
   '<div class="section-head"><h2>Glosas e pendências</h2></div>'+
   '<div class="summary">'+
   card("Glosado no mês",amount(denials?.denied_in_month),"")+
   card("Recuperado no mês",amount(denials?.recovered_in_month),"")+
   card("Perda atual",amount(denials?.loss_on_cases_opened_in_month_now),"")+
   card("NFs pendentes",String(pending?.unpaid_invoice_count??"—"),"")+
   '</div></div>';
  const expensesPage=page(heading("Despesas, Glosas e Pendências",company,label,
   "Fechamento financeiro")+
   '<div class="section-head"><h2>Despesas</h2></div>'+
   expenseCards+
   '<div class="section-head"><h2>Despesas registradas ('+expenseItems.length+')</h2></div>'+
   (expenseItems.length?table(["Descrição","Categoria","Competência","Pago em","Status","Valor"],
    expenseRows,[27,18,15,15,10,15]):
    '<div class="empty">Nenhuma despesa neste período.</div>')+
   glosaSummary+
   (denialItems.length?table(["Data","Tipo","Motivo","Valor glosado","Recuperado","Status"],
    denialRows,[12,15,30,16,14,13]):
    '<div class="empty">Nenhuma glosa neste período.</div>')+
   '<div class="footer"><span>RN Integra · Despesas, glosas e pendências</span></div>',true);
  const nonce=randomBytes(16).toString("base64");
  const js="const b=document.getElementById('print');if(b)b.addEventListener('click',()=>window.print());"+
   "window.addEventListener('load',()=>setTimeout(()=>window.print(),350));";
  const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'+
   '<meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<title>RN Integra · '+esc(label)+' · Relatório de Fechamento Mensal</title><style>'+CSS+
   '</style></head><body><div class="print-watermark" aria-hidden="true">'+
   esc(view==="closed"?"REGISTRO MENSAL":"PRÉVIA")+
   '</div><div class="print-toolbar"><span>RN Integra · '+
   esc(view==="closed"?"REGISTRO MENSAL":"PRÉVIA")+' · '+esc(label)+
   '</span><button type="button" id="print">Imprimir / Salvar PDF</button></div>'+
   attendancePage+combinedFinancePage+expensesPage+receiptChartPage+'<script nonce="'+nonce+'">'+js+'</script></body></html>';
  return new Response(html,{headers:{"Content-Type":"text/html; charset=utf-8",
   "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
   "Content-Security-Policy":"default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-"+nonce+
     "'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
 }catch{
  return Response.json({error:"Não foi possível preparar a impressão mensal."},{status:503});
 }
}
