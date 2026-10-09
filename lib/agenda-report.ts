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
