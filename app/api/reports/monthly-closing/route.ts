import {getSession} from "@/app/authz";
import {getSupabaseAdmin} from "@/lib/supabase-admin";
import {monthlyInvoiceStatus} from "@/lib/monthly-invoice-status";
import {PdfReport,brDate,brDateTime,brl,pdfResponse,type PdfColumn} from "@/lib/reports/pdf";

export const dynamic="force-dynamic";
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const monthPattern=/^\d{4}-(0[1-9]|1[0-2])$/;
type Snapshot={
 entity:{name:string;trade_name:string|null;tax_id:string|null;person_type:string};
 competence:string;
 production:{attendances:number;charges:number;professionals:number;pending_charges_now:number};
 professionals:Array<{professional_id:string;professional_name:string;attendances:number;charges:number;private_charges:number;insurance_charges:number;pending_charges_now:number;attributed_invoice_items:number}>;
 professional_attendances?:Array<{billing_record_id:string;professional_id:string;professional_name:string;patient_name:string;procedure:string;service_date:string;payer_name:string;billing_method:string;payment_status:string}>;
 professional_invoice_rows?:Array<{professional_id:string;invoice_id:string;invoice_number:string}>;
 invoices:Array<{id:string;invoice_number:string;payer:string|null;issue_date:string|null;
  paid_at:string|null;recipient_type:string;total_amount:number|null;net_amount:number|null;
  status?:"ACTIVE"|"CANCELLED"|"REPLACED";
  replaced_by_invoice_id?:string|null;replacement_invoice_number?:string|null}>;
 cash:{direct_received:number;insurance_invoice_received:number};
 direct_payments:Array<{id:string;professional_name:string;paid_at:string;received_amount:number|null;billing_method:string}>;
 expenses:{competence_total:number;paid_total:number};
 expense_items:Array<{id:string;description:string;category:string;competence_date:string;paid_at:string|null;amount:number;status:string}>;
 denial_items:Array<{id:string;denied_on:string;denial_kind:string;reason:string;denied_amount:number;recovered_amount:number;status:string}>;
};
const money=(n:number|null|undefined)=>n==null?"Não informado":brl(Number(n));
const invoiceSequence=new Intl.Collator("pt-BR",{numeric:true,sensitivity:"base"});

function grid(pdf:PdfReport,title:string,columns:PdfColumn[],rows:string[][],showWhenEmpty=false,
 tints:(null|"replaced"|"cancelled")[]=[]){
 if(!showWhenEmpty&&!rows.length)return;
 pdf.section(title,undefined,{reserve:52});
 pdf.gridTable(columns,rows,tints);
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
   {label:"Cobranças não pagas",width:1}
  ],[[String(snap.production.attendances),String(snap.production.charges),
     String(snap.production.pending_charges_now)]],true);

  grid(pdf,"Resultado de caixa — data do pagamento",[
   {label:"Recebimentos individuais",width:1,align:"right"},
   {label:"NFs convênio",width:1,align:"right"},
   {label:"Despesas pagas",width:1,align:"right"},
   {label:"Resultado",width:1,align:"right"}
  ],[[brl(snap.cash.direct_received),brl(snap.cash.insurance_invoice_received),
    brl(snap.expenses.paid_total),brl(balance)]],true);

  // Profissionais são o eixo do relatório. Uma NF pode constar em mais de um
  // profissional, mas o recebimento é somado apenas no resumo financeiro da PJ/PF.
  const invoices=[...(snap.invoices||[])].sort((a,b)=>
    invoiceSequence.compare(a.invoice_number,b.invoice_number)||
    String(a.issue_date||"").localeCompare(String(b.issue_date||""))||
    a.id.localeCompare(b.id));
  const invoiceById=new Map(invoices.map(i=>[i.id,i]));
  const assigned=new Set<string>();
  const attendanceDetails=snap.professional_attendances||[];
  const invoiceLinks=snap.professional_invoice_rows||[];
  const invoiceColumns:PdfColumn[]=[
   {label:"NF",width:57},{label:"Pagador / Tomador",width:165},
   {label:"Emissão",width:77},{label:"Pagamento",width:77},
   {label:"Bruto",width:105,align:"right"},{label:"Líquido",width:105,align:"right"},
   {label:"Tipo",width:90},{label:"Situação",width:130}
  ];
  const invoiceRows=(items:Snapshot["invoices"])=>items.map(i=>[
   i.invoice_number,i.payer||"—",brDate(i.issue_date),brDate(i.paid_at),
   money(i.total_amount),money(i.net_amount),i.recipient_type,
   monthlyInvoiceStatus(i,invoices)
  ]);
  const invoiceTints=(items:Snapshot["invoices"]):("replaced"|"cancelled"|null)[]=>
   items.map(i=>i.status==="REPLACED"?"replaced":i.status==="CANCELLED"?"cancelled":null);
  for(const professional of snap.professionals){
   const detail=attendanceDetails.filter(a=>a.professional_id===professional.professional_id);
   const linkedIds=new Set(invoiceLinks.filter(x=>x.professional_id===professional.professional_id)
     .map(x=>x.invoice_id));
   const doctorInvoices=invoices.filter(i=>linkedIds.has(i.id));
   doctorInvoices.forEach(i=>assigned.add(i.id));
   pdf.section(professional.professional_name,
     professional.attendances+" atendimento(s)  ·  "+professional.charges+" cobrança(s)  ·  "+
     professional.private_charges+" particular(es)  ·  "+professional.insurance_charges+" convênio(s)",
     {reserve:45});
   if(detail.length){
    const byPayer=new Map<string,typeof detail>();
    for(const attendance of detail){
     const label=attendance.billing_method==="PARTICULAR"?"Particular":
       attendance.payer_name||"Convênio não informado";
     const rows=byPayer.get(label)||[];rows.push(attendance);byPayer.set(label,rows);
    }
    for(const [payer,rows] of [...byPayer].sort((a,b)=>a[0].localeCompare(b[0],"pt-BR"))){
     rows.sort((a,b)=>a.service_date.localeCompare(b.service_date)||
      a.patient_name.localeCompare(b.patient_name,"pt-BR"));
     grid(pdf,"Atendimentos — "+payer,[
      {label:"Paciente",width:230},{label:"Procedimento",width:235},
      {label:"Atendimento",width:115},{label:"Pagamento",width:160}
     ],rows.map(a=>[a.patient_name,a.procedure||"—",brDate(a.service_date),
        a.payment_status==="PAGO"?"Pago":"Pendente"]));
    }
   }
   grid(pdf,"Notas fiscais — "+professional.professional_name,
    invoiceColumns,invoiceRows(doctorInvoices),false,invoiceTints(doctorInvoices));
  }
  // Notas sem vínculo com cobrança/profissional continuam visíveis, sem
  // atribuição artificial e sem participação adicional nos totais.
  const unassigned=invoices.filter(i=>!assigned.has(i.id));
  grid(pdf,"Notas fiscais sem vínculo individual",invoiceColumns,
   invoiceRows(unassigned),false,invoiceTints(unassigned));

  grid(pdf,"Recebimentos individuais",[
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
