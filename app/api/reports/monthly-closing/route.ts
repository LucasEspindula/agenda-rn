import {getSession} from "@/app/authz";
import {getSupabaseAdmin} from "@/lib/supabase-admin";
import {PdfReport,brDate,brDateTime,brl,pdfResponse,type PdfColumn} from "@/lib/reports/pdf";

export const dynamic="force-dynamic";
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const monthPattern=/^\d{4}-(0[1-9]|1[0-2])$/;
type Snapshot={
 entity:{name:string;trade_name:string|null;tax_id:string|null;person_type:string};
 competence:string;
 production:{attendances:number;charges:number;professionals:number;pending_charges_now:number};
 professionals:Array<{professional_name:string;attendances:number;charges:number;private_charges:number;insurance_charges:number;pending_charges_now:number;attributed_invoice_items:number}>;
 invoices:Array<{id:string;invoice_number:string;payer:string|null;issue_date:string|null;
  paid_at:string|null;recipient_type:string;total_amount:number|null;net_amount:number|null;
  status?:"ACTIVE"|"CANCELLED"|"REPLACED"}>;
 cash:{direct_received:number;insurance_invoice_received:number};
 direct_payments:Array<{id:string;professional_name:string;paid_at:string;received_amount:number|null;billing_method:string}>;
 expenses:{competence_total:number;paid_total:number};
 expense_items:Array<{id:string;description:string;category:string;competence_date:string;paid_at:string|null;amount:number;status:string}>;
 denial_items:Array<{id:string;denied_on:string;denial_kind:string;reason:string;denied_amount:number;recovered_amount:number;status:string}>;
};
const money=(n:number|null|undefined)=>n==null?"Não informado":brl(Number(n));
const invoiceStatus=(s:Snapshot["invoices"][number]["status"])=>
 s==="CANCELLED"?"CANCELADA":s==="REPLACED"?"SUBSTITUÍDA":s==="ACTIVE"?"ATIVA":"—";
const invoiceSequence=new Intl.Collator("pt-BR",{numeric:true,sensitivity:"base"});

function grid(pdf:PdfReport,title:string,columns:PdfColumn[],rows:string[][],showWhenEmpty=false){
 if(!showWhenEmpty&&!rows.length)return;
 pdf.section(title,undefined,{reserve:52});
 pdf.gridTable(columns,rows);
}

export async function GET(request:Request){
 if(process.env.RN_MONTHLY_CLOSING_ENABLED!=="true")
  return Response.json({error:"Relatório ainda não habilitado."},{status:404});
 const session=await getSession();
 if(!session||session.account.role!=="general_manager")
  return Response.json({error:"Acesso restrito ao Gerente Geral."},{status:403});
 const q=new URL(request.url).searchParams;
 const entity=q.get("entity_id")||"",month=q.get("month")||"",view=q.get("view")||"current";
 if(!uuid.test(entity)||!monthPattern.test(month)||!["current","closed"].includes(view))
  return Response.json({error:"Selecione entidade, competência e versão válidas."},{status:400});
 try{
  const {data,error}=await getSupabaseAdmin().rpc("get_billing_month_closing",{
   p_actor:session.account.id,p_entity:entity,p_month:month
  });
  if(error||!data)throw Error("Falha na consulta");
  if(view==="closed"&&!data.closing)
   return Response.json({error:"Não existe fechamento anterior para impressão."},{status:400});
  const snap:Snapshot=(view==="closed"?data.closing.snapshot:data.current) as Snapshot;
  const pdf=await new PdfReport().init();
  pdf.header("Fechamento mensal por PJ / PF",snap.entity.trade_name||snap.entity.name,[
   "CPF/CNPJ: "+(snap.entity.tax_id||"Não informado")+"  |  Competência: "+snap.competence,
   "Versão: "+(view==="closed"?"Fechamento bloqueado / histórico":"Posição financeira atual"),
   ...(view==="closed"&&data.closing?.closed_at?["Bloqueado em: "+brDateTime(data.closing.closed_at)]:[]),
   "Emitido em: "+brDateTime(new Date().toISOString())
  ]);
  const total=Math.round(Number(snap.cash.direct_received||0)*100)+
   Math.round(Number(snap.cash.insurance_invoice_received||0)*100);
  const balance=(total-Math.round(Number(snap.expenses.paid_total||0)*100))/100;

  grid(pdf,"Resumo da competência",[
   {label:"Atendimentos",width:1},{label:"Cobranças",width:1},
   {label:"Profissionais",width:1},{label:"Pendentes",width:1}
  ],[[String(snap.production.attendances),String(snap.production.charges),
     String(snap.production.professionals),String(snap.production.pending_charges_now)]],true);

  grid(pdf,"Resultado de caixa — data do pagamento",[
   {label:"Pagamento direto",width:1,align:"right"},
   {label:"NFs convênio",width:1,align:"right"},
   {label:"Despesas pagas",width:1,align:"right"},
   {label:"Resultado",width:1,align:"right"}
  ],[[brl(snap.cash.direct_received),brl(snap.cash.insurance_invoice_received),
    brl(snap.expenses.paid_total),brl(balance)]],true);

  grid(pdf,"Produção por profissional — data do atendimento",[
   {label:"Profissional",width:198},{label:"Atend.",width:66},
   {label:"Cobranças",width:77},{label:"Particular",width:75},
   {label:"Convênio",width:75},{label:"Pendentes",width:78},
   {label:"Itens de NF atribuídos",width:175,align:"right"}
  ],snap.professionals.map(p=>[p.professional_name,String(p.attendances),String(p.charges),
     String(p.private_charges),String(p.insurance_charges),String(p.pending_charges_now),
     brl(p.attributed_invoice_items)]));

  // Ordenação natural do número da NF: 2, 10, 100 (não 10, 100, 2).
  // O retrato histórico fechado nunca é alterado; só a ordem de apresentação muda.
  const invoices=[...(snap.invoices||[])].sort((a,b)=>
   invoiceSequence.compare(a.invoice_number,b.invoice_number)||
   String(a.issue_date||"").localeCompare(String(b.issue_date||""))||
   a.id.localeCompare(b.id));

  grid(pdf,"Notas fiscais",[
   {label:"NF",width:56},{label:"Pagador / Tomador",width:162},
   {label:"Emissão",width:78},{label:"Pagamento",width:78},
   {label:"Bruto",width:104,align:"right"},
   {label:"Líquido",width:104,align:"right"},
   {label:"Tipo",width:93},{label:"Status",width:105}
  ],invoices.map(i=>[i.invoice_number,i.payer||"—",brDate(i.issue_date),
    brDate(i.paid_at),money(i.total_amount),money(i.net_amount),i.recipient_type,
    invoiceStatus(i.status)]));

  grid(pdf,"Pagamentos diretos",[
   {label:"Profissional",width:290},{label:"Data",width:130},
   {label:"Cobrança",width:160},{label:"Valor",width:194,align:"right"}
  ],snap.direct_payments.map(p=>[p.professional_name,brDate(p.paid_at),
    p.billing_method,money(p.received_amount)]));

  grid(pdf,"Despesas",[
   {label:"Descrição",width:236},{label:"Categoria",width:122},
   {label:"Competência",width:96},{label:"Pagamento",width:96},
   {label:"Situação",width:105},{label:"Valor",width:119,align:"right"}
  ],snap.expense_items.map(e=>[e.description,e.category,brDate(e.competence_date),
    brDate(e.paid_at),e.status,brl(e.amount)]));

  grid(pdf,"Glosas e recuperações",[
   {label:"Data",width:92},{label:"Tipo",width:88},
   {label:"Motivo",width:250},{label:"Glosado",width:116,align:"right"},
   {label:"Recuperado",width:116,align:"right"},
   {label:"Situação",width:112}
  ],snap.denial_items.map(d=>[brDate(d.denied_on),d.denial_kind,d.reason,
     brl(d.denied_amount),brl(d.recovered_amount),d.status]));

  return pdfResponse(pdf,"rn-integra-fechamento-"+month+"-"+view+".pdf");
 }catch{
  return Response.json({error:"Não foi possível gerar o PDF do fechamento."},{status:503,
   headers:{"Cache-Control":"private, no-store"}});
 }
}
