import {getSession} from '@/app/authz';
import {loadBillingData} from '@/lib/billing-data';
import {isAnesthesiologist} from '@/lib/medical-specialties';
import {agendaDateLabel,agendaTimeline,appointmentInsurance,appointmentStatusLabel} from '@/lib/agenda-report';
import {PdfReport,brDate,brDateTime,pdfResponse} from '@/lib/reports/pdf';

export const dynamic='force-dynamic';
type Professional={id:string;name:string;crm?:string;specialty?:string};type Appointment={doctorId?:string;anesthetistId?:string;date:string;time?:string;patientId:string;procedure?:string;insurance?:string|null;hospitalId?:string;status?:string};type ScheduleBlock={professionalId:string;date:string;start:string;end:string;reason:string};type Patient={id:string;name:string;insurance?:string};type Hospital={id:string;name:string};
const date=/^\d{4}-\d{2}-\d{2}$/;
const add=(value:string,days:number)=>{const result=new Date(value+'T12:00:00');result.setDate(result.getDate()+days);return result.toISOString().slice(0,10)};
const periodFor=(mode:string,day:string)=>{if(mode==='week'){const weekday=new Date(day+'T12:00:00').getDay();return {start:add(day,-weekday),end:add(day,6-weekday)}}if(mode==='month'){const current=new Date(day+'T12:00:00');return {start:day.slice(0,7)+'-01',end:new Date(current.getFullYear(),current.getMonth()+1,0).toISOString().slice(0,10)}}return {start:day,end:day}};

const groupByDay=<T extends {date:string}>(rows:readonly T[]):Array<[string,T[]]>=>{
 const groups=new Map<string,T[]>();
 for(const row of rows){const items=groups.get(row.date)||[];items.push(row);groups.set(row.date,items)}
 return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b));
};
export async function GET(request:Request){
 const session=await getSession(),params=new URL(request.url).searchParams;
 const professionalId=params.get('professional_id')||'',mode=params.get('period')||'day',day=params.get('date')||'';
 if(!session)return Response.json({error:'Acesso negado.'},{status:403});
 if(!professionalId||!date.test(day)||!['day','week','month'].includes(mode))return Response.json({error:'Parâmetros de impressão inválidos.'},{status:400});
 try{
  const {state}=await loadBillingData();
  const snapshot=state as {professionals?:Professional[];patients?:Patient[];hospitals?:Hospital[];appointments?:Appointment[];scheduleBlocks?:ScheduleBlock[]};
  const professional=snapshot.professionals?.find(item=>item.id===professionalId);
  if(!professional)return Response.json({error:'Agenda não encontrada.'},{status:404});
  if(session.account.role!=='general_manager'&&!session.agendaIds.includes(professionalId))return Response.json({error:'Agenda sem acesso.'},{status:403});
  const period=periodFor(mode,day),anesthesiologist=isAnesthesiologist(professional);
  const patients=new Map((snapshot.patients||[]).map(item=>[item.id,item] as const));
  const professionals=new Map((snapshot.professionals||[]).map(item=>[item.id,item] as const));
  const hospitals=new Map((snapshot.hospitals||[]).map(item=>[item.id,item] as const));
  const appointments=(snapshot.appointments||[]).filter(item=>(anesthesiologist?item.anesthetistId===professionalId:item.doctorId===professionalId)&&item.status!=='cancelled'&&item.date>=period.start&&item.date<=period.end).sort((a,b)=>a.date.localeCompare(b.date)||(a.time||'').localeCompare(b.time||''));
  const blocks=(snapshot.scheduleBlocks||[]).filter(item=>item.professionalId===professionalId&&item.date>=period.start&&item.date<=period.end).sort((a,b)=>a.date.localeCompare(b.date)||a.start.localeCompare(b.start));
  const pdf=await new PdfReport().init();
  const centerTitle=mode==='week'?'Agenda da semana':mode==='month'?'Agenda do mês':'Agenda do dia';
  pdf.header('Agenda',professional.name+(professional.crm?' · CRM: '+professional.crm:''),[
   'Período: '+brDate(period.start)+(period.end!==period.start?' a '+brDate(period.end):'')
  ],[
   'Gerado em: '+brDateTime(new Date().toISOString()),
   'Gerado por: '+session.account.name
  ],centerTitle);
  const timeline=agendaTimeline(appointments,blocks);
  pdf.section('Programação',undefined,{reserve:48});
  for(const [date,entries] of groupByDay(timeline)){
   pdf.dayHeading(agendaDateLabel(date));
   const rows=entries.map(entry=>{
    if(entry.kind==='block')return [
     entry.block.start+' - '+entry.block.end,
     'HORÁRIO BLOQUEADO','—',
     'Motivo: '+(entry.block.reason||'Indisponibilidade do profissional'),
     '—','—','Bloqueado'
    ];
    const item=entry.appointment;
    return [
     item.time||'—',
     patients.get(item.patientId)?.name||'Não informado',
     professionals.get(anesthesiologist?item.doctorId||'':item.anesthetistId||'')?.name||'—',
     item.procedure||'—',
     appointmentInsurance(item,patients.get(item.patientId))||'—',
     hospitals.get(item.hospitalId||'')?.name||'—',
     appointmentStatusLabel(item.status)
    ];
   });
   const rowTints=entries.map(entry=>entry.kind==='block'?'blocked' as const:null);
   pdf.gridTable([
    {label:'Horário',width:69},{label:'Paciente',width:144},
    {label:anesthesiologist?'Médico':'Anestesista',width:108},
    {label:'Procedimento / Motivo',width:153},{label:'Convênio',width:96},
    {label:'Hospital',width:117},{label:'Status',width:71}
   ],rows,rowTints);
  }
  if(!timeline.length){
   pdf.ensureSpace(16);
   pdf.text('Nenhum atendimento ou bloqueio no período selecionado.',pdf.margin,pdf.y,9);
   pdf.y-=22;
  }
  return pdfResponse(pdf,'agenda-'+professionalId+'-'+period.start+'.pdf');
 }catch{
  return Response.json({error:'Não foi possível gerar a agenda.'},{status:503});
 }
}
