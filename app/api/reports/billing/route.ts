// @ts-nocheck
import {getSession} from '@/app/authz';
import {loadBillingData} from '@/lib/billing-data';
import {doctorBillingProjection} from '@/lib/billing-projection';
import {canOpenBilling,canOpenInvoices} from '@/lib/doctor-services';
import {buildReport,type ReportScope} from '@/lib/billing-reports';
import {companyLabel,invoiceStatus,rowEntityId,rowStatus} from '@/lib/billing-row';
import {activeInvoice} from '@/lib/fiscal-document';
import {PdfReport,brDate,brl,pdfResponse} from '@/lib/reports/pdf';

export const dynamic='force-dynamic';
const kinds=new Set<ReportScope['kind']>(['filtered','doctor','entity','invoices','pending']);
const value=(params:URLSearchParams,key:string)=>params.get(key)||'';
function scopeFrom(request:Request):ReportScope|null{
 const p=new URL(request.url).searchParams,kind=p.get('kind') as ReportScope['kind'];
 if(!kinds.has(kind))return null;
 return {kind,doctor:value(p,'doctor'),entity:value(p,'entity'),start:value(p,'start'),end:value(p,'end'),insurance:value(p,'insurance'),patient:value(p,'patient'),status:value(p,'status'),issued_at:new Date().toISOString()};
}
export async function GET(request:Request){
 const session=await getSession(),scope=scopeFrom(request);
 if(!session)return Response.json({error:'Acesso negado.'},{status:403});
 if(!scope)return Response.json({error:'Relatório inválido.'},{status:400});
 if(session.account.role==='secretary')return Response.json({error:'Área restrita à gerência.'},{status:403});
 if(session.account.role==='doctor'&&!(scope.kind==='invoices'?canOpenInvoices(session):canOpenBilling(session)))return Response.json({error:'Acesso negado.'},{status:403});
 try{
  let {data}=await loadBillingData();
  if(session.account.role==='doctor')data=doctorBillingProjection(data,session,scope.kind==='invoices');
  const report=buildReport(data,scope),pdf=await new PdfReport().init();
  const title={filtered:'Atendimentos filtrados',doctor:'Relatório do médico',entity:'Relatório da empresa / PJ',invoices:'Relação de Notas Fiscais',pending:'Pendências de Convênio'}[scope.kind];
  const doctor=(id:string)=>data.doctors.find(d=>d.id===id)?.name||'—';
  const entity=data.entities.find(e=>e.id===scope.entity);
  const subject=entity?entity.name:scope.doctor?doctor(scope.doctor):'Período: '+(scope.start?brDate(scope.start):'início')+' a '+(scope.end?brDate(scope.end):'fim');
  pdf.header(title,subject);
  if(scope.kind==='invoices'){
   pdf.table([{label:'NF',width:58},{label:'Empresa',width:132},{label:'Pagador',width:125},{label:'Emissão',width:63},{label:'Pagamento',width:70},{label:'Bruto',width:76,align:'right'},{label:'Líquido',width:76,align:'right'},{label:'Status',width:82}],report.invoices.map(i=>[i.invoice_number,data.entities.find(e=>e.id===i.billing_entity_id)?.name||'—',i.payer,brDate(i.issue_date),brDate(i.paid_at),i.shared?'NF compartilhada':brl(i.total_amount),i.shared?'Total restrito':brl(i.net_amount),invoiceStatus(i)]));
   const active=report.invoices.filter(activeInvoice); pdf.text(active.length+' nota(s) ativa(s) · Total líquido válido: '+brl(active.reduce((n,i)=>n+Number(i.net_amount||0),0)),pdf.margin,pdf.y,8,true);
  }else{
   const rows=report.rows;
   pdf.table([{label:'Paciente',width:104},{label:'Data',width:56},{label:'Procedimento',width:96},{label:'Médico',width:96},{label:'Empresa',width:96},{label:'Pagador',width:79},{label:'NF',width:52},{label:'Pagamento',width:60},{label:'Valor',width:62,align:'right'},{label:'Status',width:62}],rows.map(r=>[r.patient,brDate(r.date),r.procedure,doctor(r.doctor_id),companyLabel(data,rowEntityId(r)),r.insurance||'—',r.invoice?.invoice_number||r.record?.invoice_number||'—',brDate(r.invoice?.paid_at||r.record?.paid_at),brl(r.invoice_item?.received_amount??r.record?.received_amount),rowStatus(r)]));
   pdf.text('Atendimentos: '+report.summary.total+' · Pagos: '+report.summary.paid+' · Pendentes: '+report.summary.pending+' · Valor individualizado: '+brl(report.summary.received),pdf.margin,pdf.y,8,true);
  }
  return pdfResponse(pdf,'rn-integra-'+scope.kind+'.pdf');
 }catch(error){return Response.json({error:error instanceof Error?error.message:'Não foi possível gerar o relatório.'},{status:400});}
}
