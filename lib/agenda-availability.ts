/**
 * Canonical, local-clock availability projection for the legacy Agenda,
 * the mobile timeline, and server validation. Appointments and blocks store
 * date (YYYY-MM-DD) and time (HH:mm), not UTC instants.
 */
export type AvailabilityRule={id?:string;professionalId:string;name?:string;enabled?:boolean;severity?:string;blockAllDay?:boolean;weekday?:number|string|null;occurrence?:string;start?:string;end?:string;forbiddenTimes?:string;preferredTimes?:string;hospitalId?:string|null;procedureContains?:string;maxPatients?:number|string};
export type AvailabilityBlock={id?:string;professionalId:string;date:string;start:string;end:string;reason?:string;hospitalId?:string|null};
export type AvailabilityAppointment={id?:string;doctorId?:string|null;anesthetistId?:string|null;date:string;time:string;duration:number;hospitalId?:string;procedure?:string;status?:string};
export type AvailabilityState={settings?:{workStart?:string;workEnd?:string};professionals?:Array<{id:string;agendaSettings?:{workStart?:string;workEnd?:string};specialty?:string}>;schedulingRules?:AvailabilityRule[];scheduleBlocks?:AvailabilityBlock[];appointments?:AvailabilityAppointment[]};
export type AvailabilityInterval={start:number;end:number;kind:'manual'|'rule';name:string;reason:string;id?:string;rule?:AvailabilityRule};
export const minutes=(value:string)=>{const p=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(value||'');return p?Number(p[1])*60+Number(p[2]):NaN};
export const timeLabel=(n:number)=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');
export const intervalsOverlap=(a:number,b:number,c:number,d:number)=>a<d&&b>c;
export const splitTimes=(value:string|undefined)=>(value||'').split(',').map(v=>v.trim()).filter(Boolean);
function dateParts(date:string){
 const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
 if(!m)return null;
 const d=new Date(Number(m[1]),Number(m[2])-1,Number(m[3]),12);
 if(d.getFullYear()!==Number(m[1])||d.getMonth()!==Number(m[2])-1||d.getDate()!==Number(m[3]))return null;
 return {weekday:d.getDay(),occurrence:Math.floor((d.getDate()-1)/7)+1,
   isLast:new Date(d.getFullYear(),d.getMonth(),d.getDate()+7,12).getMonth()!==d.getMonth()};
}
export function ruleMatchesLocalDate(rule:AvailabilityRule,date:string){
 if(rule.enabled===false)return false;
 const day=dateParts(date);if(!day)return false;
 if(rule.weekday!==''&&rule.weekday!=null&&Number(rule.weekday)!==day.weekday)return false;
 if(rule.occurrence){
  if(rule.occurrence==='last'&&!day.isLast)return false;
  if(rule.occurrence!=='last'&&Number(rule.occurrence)!==day.occurrence)return false;
 }
 return true;
}
export function professionalHours(state:AvailabilityState,professionalId:string){
 const professional=state.professionals?.find(p=>p.id===professionalId);
 const from=minutes(professional?.agendaSettings?.workStart||state.settings?.workStart||'07:00');
 const to=minutes(professional?.agendaSettings?.workEnd||state.settings?.workEnd||'19:00');
 return {start:Number.isFinite(from)?from:420,end:Number.isFinite(to)?to:1140};
}
export function availabilityIntervals(state:AvailabilityState,professionalId:string,date:string,includeRules=true):AvailabilityInterval[]{
 const {start:workStart,end:workEnd}=professionalHours(state,professionalId);
 const out:AvailabilityInterval[]=[];
 for(const b of state.scheduleBlocks||[]){
  if(b.professionalId!==professionalId||b.date!==date)continue;
  const start=minutes(b.start),end=minutes(b.end);
  if(Number.isFinite(start)&&Number.isFinite(end)&&end>start)
   out.push({start,end,kind:'manual',id:b.id,name:'HORÁRIO BLOQUEADO',reason:b.reason||'Indisponível'});
 }
 if(includeRules){
  for(const r of state.schedulingRules||[]){
   if(r.professionalId!==professionalId||!ruleMatchesLocalDate(r,date)||(r.severity!=='block'&&!r.blockAllDay))continue;
   const append=(start:number,end:number,reason:string)=>{
    if(Number.isFinite(start)&&Number.isFinite(end)&&end>start)
     out.push({start,end,kind:'rule',id:r.id,rule:r,name:r.blockAllDay?'DIA BLOQUEADO':'HORÁRIO INDISPONÍVEL',reason});
   };
   if(r.blockAllDay){append(workStart,workEnd,r.name||'Regra de indisponibilidade');continue;}
   // The original rule model defines its start/end as an *allowed*
   // window; the portions outside it are unavailable.
   if(r.start){const from=minutes(r.start);if(from>workStart)append(workStart,Math.min(from,workEnd),r.name||'Regra de horário');}
   if(r.end){const to=minutes(r.end);if(to<workEnd)append(Math.max(to,workStart),workEnd,r.name||'Regra de horário');}
   for(const slot of splitTimes(r.forbiddenTimes)){
    const from=minutes(slot);append(from,Math.min(from+30,workEnd),r.name||'Horário proibido');
   }
  }
 }
 return out.sort((a,b)=>a.start-b.start||a.end-b.end);
}
export function entirelyUnavailable(state:AvailabilityState,professionalId:string,date:string,includeRules=true){
 const {start,end}=professionalHours(state,professionalId);
 if(end<=start)return false;
 const intervals=availabilityIntervals(state,professionalId,date,includeRules)
   .filter(b=>b.end>start&&b.start<end);
 let covered=start;
 for(const b of intervals){if(b.start>covered)return false;covered=Math.max(covered,b.end);if(covered>=end)return true;}
 return false;
}
export function appointmentAvailabilityIssues(state:AvailabilityState,a:AvailabilityAppointment){
 if(!a.date||!a.time)return [] as string[];
 const start=minutes(a.time),end=start+Number(a.duration||0);
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return ['Duração ou horário inválido.'];
 const issues:string[]=[];
 const ids=[...new Set([a.doctorId,a.anesthetistId].filter((id):id is string=>!!id))];
 for(const id of ids){
  const isSurgeon=id===a.doctorId;
  for(const b of availabilityIntervals(state,id,a.date,isSurgeon)){
   if(intervalsOverlap(start,end,b.start,b.end))
    issues.push(`${b.name}: ${timeLabel(b.start)} – ${timeLabel(b.end)}`);
  }
 }
 for(const r of state.schedulingRules||[]){
  if(!a.doctorId||r.professionalId!==a.doctorId||!ruleMatchesLocalDate(r,a.date)||r.severity!=='block'||r.blockAllDay)continue;
  if(r.hospitalId&&r.hospitalId!==a.hospitalId)continue;
  if(r.procedureContains&&!String(a.procedure||'').toLowerCase().includes(r.procedureContains.toLowerCase()))continue;
  const preferred=splitTimes(r.preferredTimes);
  if(preferred.length&&!preferred.includes(a.time))issues.push('Horário não permitido pela regra '+(r.name||''));
  if(r.maxPatients&&Number(r.maxPatients)>0){
   const count=(state.appointments||[]).filter(x=>x.id!==a.id&&x.doctorId===a.doctorId&&x.date===a.date&&x.status!=='cancelled'&&(!r.hospitalId||x.hospitalId===r.hospitalId)).length;
   if(count>=Number(r.maxPatients))issues.push('Limite de atendimentos atingido: '+(r.name||''));
  }
 }
 return issues;
}
export function appointmentAvailabilityChanged(before:AvailabilityAppointment|undefined,after:AvailabilityAppointment){
 if(!before)return true;
 return (['date','time','duration','doctorId','anesthetistId','hospitalId','procedure'] as const)
   .some(k=>String(before[k]??'')!==String(after[k]??''));
}
export function changedAppointmentIssues(before:AvailabilityState,after:AvailabilityState){
 const previous=new Map((before.appointments||[]).map(a=>[a.id,a]));
 return (after.appointments||[]).flatMap(a=>{
  if(a.status==='cancelled'||!appointmentAvailabilityChanged(previous.get(a.id),a))return [];
  return appointmentAvailabilityIssues(after,a).map(problem=>({appointmentId:a.id||'',problem}));
 });
}
