import {getSession} from "@/app/authz";
import {getSupabaseAdmin} from "@/lib/supabase-admin";
import {PdfReport,brDate,brDateTime,brl,pdfResponse,type PdfColumn} from "@/lib/reports/pdf";

export const dynamic="force-dynamic";
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const monthPattern=/^\d{4}-(0[1-9]|1[0-2])$/;
type Row={id:string;[key:string]:unknown};
type Amount={direct_received:number;insurance_invoice_received:number};
type Snap={
 entity:{name:string;trade_name:string|null;tax_id:string;person_type:string};
 competence:string;
 production:{attendances:number;charges:number;professionals:number;pending_charges_now:number};
 professionals:Array<{professional_name:string;attendances:number;charges:number;private_charges:number;insurance_charges:number;pending_charges_now:number;attributed_invoice_items:number}>;
 issued_invoices:{count:number;gross_total:number;net_total:number};
 invoices:Array<{id:string;invoice_number:string;payer:string;issue_date:string;paid_at:string|null;recipient_type:string;total_amount:number|null;net_amount:number|null}>;
 cash:Amount;
 direct_payments:Array<{id:string;professional_name:string;paid_at:string;received_amount:number|null;billing_method:string}>;
 expenses:{competence_total:number;paid_total:number};
 expense_items:Array<{id:string;description:string;category:string;competence_date:string;paid_at:string|null;amount:number;status:string}>;
 denials:{denied_in_month:number;recovered_in_month:number;loss_on_cases_opened_in_month_now:number};
 denial_items:Array<{id:string;denied_on:string;denial_kind:string;reason:string;denied_amount:number;recovered_amount:number;status:string}>;
 pending_now:{unpaid_invoice_count:number;unpaid_invoice_net:number};
};
const amount=(n:number|null|undefined)=>n==null?"Não identificado":brl(Number(n));
function section(report:PdfReport,title:string,columns:PdfColumn[],rows:string[][]){
 report.section(title,undefined,{reserve:34});
 report.table(columns,rows);
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
  const snap:Snap=(view==="closed"?data.closing.snapshot:data.current) as Snap;
  const pdf=await new PdfReport().init();
  pdf.header("Fechamento mensal por PJ / PF",snap.entity.trade_name||snap.entity.name,[
   "CPF/CNPJ: "+(snap.entity.tax_id||"Não informado")+"  |  Competência: "+snap.competence,
   "Versão: "+(view==="closed"?"Fechamento bloqueado / histórico":"Posição financeira atual"),
   ...(view==="closed"&&data.closing?.closed_at?["Bloqueado em: "+brDateTime(data.closing.closed_at)]:[]),
   "Emitido em: "+brDateTime(new Date().toISOString())
  ]);
  const total=Number(snap.cash.direct_received||0)+Number(snap.cash.insurance_invoice_received||0);
  const result=total-Number(snap.expenses.paid_total||0);
  section(pdf,"Resumo da competência",[
   {label:"Atendimentos",width:130},{label:"Cobranças",width:130},
   {label:"Profissionais",width:125},{label:"Pendentes",width:128}
  ],[[String(snap.production.attendances),String(snap.production.charges),
      String(snap.production.professionals),String(snap.production.pending_charges_now)]]);
  section(pdf,"Resultado de caixa — data do pagamento",[
   {label:"Pagamento direto",width:180,align:"right"},
   {label:"NFs convênio",width:180,align:"right"},
   {label:"Despesas pagas",width:180,align:"right"},
   {label:"Resultado",width:180,align:"right"}
  ],[[brl(snap.cash.direct_received),brl(snap.cash.insurance_invoice_received),
    brl(snap.expenses.paid_total),brl(result)]]);
  section(pdf,"Produção por profissional — data do atendimento",[
   {label:"Profissional",width:192},{label:"Atend.",width:60},
   {label:"Cobranças",width:60},{label:"Particular",width:62},
   {label:"Convênio",width:62},{label:"Pendentes",width:72},
   {label:"Itens de NF atribuídos",width:150,align:"right"}
  ],snap.professionals.map(p=>[p.professional_name,String(p.attendances),String(p.charges),
      String(p.private_charges),String(p.insurance_charges),String(p.pending_charges_now),
      brl(p.attributed_invoice_items)]));
  section(pdf,"Notas fiscais — emissão ou pagamento no mês",[
   {label:"NF",width:73},{label:"Pagador / Tomador",width:167},
   {label:"Emissão",width:75},{label:"Pagamento",width:76},
   {label:"Bruto",width:94,align:"right"},{label:"Líquido",width:94,align:"right"},
   {label:"Tipo",width:100}
  ],snap.invoices.map(i=>[i.invoice_number,i.payer,brDate(i.issue_date),
    brDate(i.paid_at),amount(i.total_amount),amount(i.net_amount),i.recipient_type]));
  section(pdf,"Pagamentos diretos",[
   {label:"Profissional",width:270},{label:"Data",width:95},
   {label:"Cobrança",width:140},{label:"Valor",width:145,align:"right"}
  ],snap.direct_payments.map(p=>[p.professional_name,brDate(p.paid_at),
    p.billing_method,amount(p.received_amount)]));
  section(pdf,"Despesas",[
   {label:"Descrição",width:245},{label:"Categoria",width:117},
   {label:"Competência",width:91},{label:"Pagamento",width:91},
   {label:"Situação",width:87},{label:"Valor",width:110,align:"right"}
  ],snap.expense_items.map(e=>[e.description,e.category,brDate(e.competence_date),
    brDate(e.paid_at),e.status,brl(e.amount)]));
  section(pdf,"Glosas e recuperações (informativo)",[
   {label:"Data",width:79},{label:"Tipo",width:83},
   {label:"Motivo",width:290},{label:"Glosado",width:100,align:"right"},
   {label:"Recuperado",width:108,align:"right"},{label:"Situação",width:107}
  ],snap.denial_items.map(d=>[brDate(d.denied_on),d.denial_kind,d.reason,
     brl(d.denied_amount),brl(d.recovered_amount),d.status]));
  pdf.section("Pendências e critérios");
  pdf.text("Notas sem pagamento (situação na versão): "+String(snap.pending_now.unpaid_invoice_count)+
    "  |  Valor líquido: "+brl(snap.pending_now.unpaid_invoice_net),pdf.margin,pdf.y,8);
  pdf.y-=15;
  pdf.text("NF de convênio contabilizada uma vez. Recuperação de glosa NÃO é uma segunda receita.",
    pdf.margin,pdf.y,7);
  pdf.y-=15;
  pdf.text("Lançamentos retroativos continuam permitidos após o fechamento; o histórico é preservado.",
    pdf.margin,pdf.y,7);
  return pdfResponse(pdf,"rn-integra-fechamento-"+month+"-"+view+".pdf");
 }catch{
  return Response.json({error:"Não foi possível gerar o PDF do fechamento."},{status:503,
    headers:{"Cache-Control":"private, no-store"}});
 }
}
