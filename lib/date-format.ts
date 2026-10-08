type DateTimeOptions={timeZone?:string};
type DateValue=string|number|null|undefined;

function dateParts(value:DateValue){
 if(typeof value!=='string')return null;
 const match=/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(value.trim());
 if(!match)return null;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 const candidate=new Date(Date.UTC(year,month-1,day));
 if(candidate.getUTCFullYear()!==year||candidate.getUTCMonth()!==month-1||candidate.getUTCDate()!==day)return null;
 return {year,month,day};
}

export function formatDateBR(value:DateValue){
 const parts=dateParts(value);
 return parts?String(parts.day).padStart(2,'0')+'/'+String(parts.month).padStart(2,'0')+'/'+String(parts.year):'—';
}

export function formatDateTimeBR(value:DateValue,options:DateTimeOptions={}){
 if((typeof value!=='string'&&typeof value!=='number')||(typeof value==='string'&&!value.trim()))return '—';
 const date=new Date(value);
 if(Number.isNaN(date.getTime()))return '—';
 const formatter=new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,...options});
 const parts=Object.fromEntries(formatter.formatToParts(date).filter(part=>['day','month','year','hour','minute'].includes(part.type)).map(part=>[part.type,part.value]));
 return parts.day+'/'+parts.month+'/'+parts.year+' '+parts.hour+':'+parts.minute;
}
