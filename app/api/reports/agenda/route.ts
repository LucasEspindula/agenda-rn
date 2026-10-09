// @ts-nocheck
import {getSession} from '@/app/authz';
import {loadBillingData} from '@/lib/billing-data';
import {PdfReport,brDate,pdfResponse} from '@/lib/reports/pdf';

export const dynamic='force-dynamic';
const date=/^\d{4}-\d{2}-\d{2}$/;
const add=(value:string,days:number)=>{const d=new Date(value+'T12:00:00');d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)};
const range=(mode:string,day:string)=>{if(mode==='week'){const weekday=new Date(day+'T12:00:00').getDay();return {start:add(day,-weekday),end:add(day,6-weekday)}}if(mode==='month'){const d=new Date(day+'T12:00:00');return {start:day.slice(0,7)+'-01',end:new Date(d.getFullYear(),d.getMonth()+1,0).toISOString().slice(0,10)}}return {start:day,end:day}};
export async function GET(request:Request){
 const session=await getSession(),p=new URL(request.url).searchParams,professionalId=p.get('professional_id')||'',mode=p.get('period')||'day',day=p.get('date')||'';
 if(!session)return Response.json({error:'Acesso negado.'},{status:403});
 if(!professionalId||!date.test(day)||!['day','week','month'].includes(mode))return Response.json({error:'Parâmetros de impressão inválidos.'},{status:400});
 try{
  const {state}=await loadBillingData(),professional=(state.professionals||[]).find((x:{id:string})=>x.id===professionalId);
  if(!professional)return Response.json({error:'Agenda não encontrada.'},{status:404});
  if(session.account.role!=='general_manager'&&!session.agendaIds.includes(professionalId))return Response.json({error:'Agenda sem acesso.'},{status:403});
  const period=range(mode,day),patientRows=(state.patients||[]) as {id:string;name:string;insurance?:string}[],hospitalRows=(state.hospitals||[]) as {id:string;name:string}[];
  const patients=new Map(patientRows.map(x=>[x.id,x] as const)),hospitals=new Map(hospitalRows.map(x=>[x.id,x] as const));
  const appointments=(state.appointments||[]).filter((a:{doctorId?:string;anesthetistId?:string;date:string})=>(a.doctorId===professionalId||a.anesthetistId===professionalId)&&a.date>=period.start&&a.date<=period.end).sort((a:{date:string;time?:string},b:{date:string;time?:string})=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  const pdf=await new PdfReport().init();
  pdf.header('Agenda',String(professional.name||'')+' · '+brDate(period.start)+(period.end!==period.start?' a '+brDate(period.end):''));
  pdf.table([{label:'Data',width:62},{label:'Hora',width:48},{label:'Paciente',width:130},{label:'Procedimento',width:128},{label:'Convênio',width:90},{label:'Hospital',width:112},{label:'Status',width:74}],appointments.map((a:{date:string;time?:string;patientId:string;procedure?:string;insurance?:string;hospitalId?:string;status?:string})=>[brDate(a.date),a.time||'—',patients.get(a.patientId)?.name||'Paciente não informado',a.procedure||'—',a.insurance||patients.get(a.patientId)?.insurance||'Particular',hospitals.get(a.hospitalId||'')?.name||'—',a.status||'—']));
  if(!appointments.length)pdf.text('Nenhum atendimento no período selecionado.',pdf.margin,pdf.y,9);
  return pdfResponse(pdf,'agenda-'+professionalId+'-'+period.start+'.pdf');
 }catch{return Response.json({error:'Não foi possível gerar a agenda.'},{status:503});}
}
