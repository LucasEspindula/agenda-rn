// Datas civis (YYYY-MM-DD), sem dependência de fuso horário do navegador.
// Nenhum prazo é presumido sem regra explícita e vigente.
const pattern=/^\d{4}-\d{2}-\d{2}$/;
export function validCivilDate(date){
 if(typeof date!=="string"||!pattern.test(date))return false;
 const parsed=new Date(date+"T00:00:00.000Z");
 return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
}
export function addCalendarDays(date,days){
 if(!validCivilDate(date)||!Number.isInteger(days))return null;
 const d=new Date(date+"T00:00:00.000Z");
 d.setUTCDate(d.getUTCDate()+days);
 return d.toISOString().slice(0,10);
}
export const destinationKey=value=>String(value||"").replace(/\s+/g," ").trim().toLocaleUpperCase("pt-BR");
export function matchDeadlineRule(rules,{serviceDate,destination,professionalId,channel}){
 if(!validCivilDate(serviceDate))return null;
 const dest=destinationKey(destination);
 const matching=rules.filter(rule=>
  rule.active!==false &&
  destinationKey(rule.destination_key)===dest &&
  rule.submission_channel_code===channel &&
  (!rule.professional_id||rule.professional_id===professionalId) &&
  rule.valid_from<=serviceDate && (!rule.valid_to||serviceDate<=rule.valid_to) &&
  Number.isInteger(rule.deadline_days) && rule.deadline_days>0);
 // Específico do profissional prevalece; vigência mais recente desempata.
 matching.sort((a,b)=>
  Number(!!b.professional_id)-Number(!!a.professional_id)||
  b.valid_from.localeCompare(a.valid_from));
 return matching[0]||null;
}
export function calculatePortalDeadline({today,serviceDate,guideReceivedAt,submittedAt,rule}){
 if(submittedAt)return {state:"SUBMITTED",deadline:null,remaining:null};
 if(!rule)return {state:"NO_RULE",deadline:null,remaining:null};
 const origin=rule.starts_from==="GUIDE_RECEIVED"?guideReceivedAt:serviceDate;
 if(!validCivilDate(origin))return {state:"WAITING_GUIDE",deadline:null,remaining:null};
 const deadline=addCalendarDays(origin,rule.deadline_days);
 if(!validCivilDate(today)||!deadline)return {state:"NO_DATE",deadline:null,remaining:null};
 const remaining=Math.round((Date.parse(deadline+"T00:00:00Z")-Date.parse(today+"T00:00:00Z"))/86400000);
 return {state:remaining<0?"OVERDUE":remaining<=rule.alert_before_days?"ALERT":"ON_TIME",deadline,remaining};
}
