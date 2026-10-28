export function appointmentInsurance(appointment:{insurance?:string|null},patient:{insurance?:string|null}|undefined):string{
  return appointment.insurance!=null?String(appointment.insurance):String(patient?.insurance||'');
}
export function appointmentStatusLabel(status?:string|null):string{
  const labels:Record<string,string>={
    scheduled:'Agendado',confirmed:'Confirmado',authorized:'Autorizado',analysis:'Análise',
    realized:'Realizado',rescheduled:'Agendado',provisional:'Agendado',attended:'Realizado'
  };
  return labels[String(status||'')]||String(status||'—');
}

export function agendaDateLabel(value:string):string{
 const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
 if(!match)return value||'—';
 const weekday=new Intl.DateTimeFormat('pt-BR',{weekday:'long',timeZone:'UTC'}).format(new Date(value+'T12:00:00Z'));
 return weekday.charAt(0).toLocaleUpperCase('pt-BR')+weekday.slice(1)+' '+match[3]+'/'+match[2]+'/'+match[1];
}
