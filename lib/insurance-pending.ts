import type {BillingData,BillingRow} from './billing-types';
import {companyLabel,isInsurancePending,matchesRow,rowEntityId,type RowFilters} from './billing-row';
import {directPayment} from './billing-finance';
import {activeInvoice} from './fiscal-document';
import {payerKey} from './billing-eligibility';

export type PendingFilters=Omit<RowFilters,'status'>&{search?:string};
export const pendingToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function pendingAge(date:string,today=pendingToday()){
 return Math.max(0,Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(date.slice(0,10)+'T00:00:00Z'))/86400000));
}
const searchKey=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').trim();
export function filterPendingRows(data:BillingData,filters:PendingFilters){
 const term=searchKey(filters.search||'');
 return data.rows.filter(isInsurancePending).filter(r=>matchesRow(r,{entity:filters.entity,doctor:filters.doctor,insurance:filters.insurance,start:filters.start,end:filters.end})&&(!term||searchKey(r.patient+' '+r.procedure).includes(term)))
 .sort((a,b)=>a.date.localeCompare(b.date)||a.patient.localeCompare(b.patient,'pt-BR')||a.attendance_id.localeCompare(b.attendance_id));
}
export function pendingSummary(rows:BillingRow[],today=pendingToday()){
 const ages=rows.map(r=>pendingAge(r.date,today));
 return {total:rows.length,oldest:ages.length?Math.max(...ages):0,companies:new Set(rows.map(rowEntityId)).size,over60:ages.filter(n=>n>60).length,buckets:[ages.filter(n=>n<=30).length,ages.filter(n=>n>30&&n<=60).length,ages.filter(n=>n>60&&n<=90).length,ages.filter(n=>n>90).length]};
}
export function groupPendingRows(data:BillingData,rows:BillingRow[],today=pendingToday()){
 const companies=new Map<string,Map<string,BillingRow[]>>();
 for(const row of rows){const entity=rowEntityId(row),payer=payerKey(row.insurance);if(!companies.has(entity))companies.set(entity,new Map());const payers=companies.get(entity)!;if(!payers.has(payer))payers.set(payer,[]);payers.get(payer)!.push(row)}
 return [...companies].map(([id,payers])=>{const companyRows=[...payers.values()].flat();return {id,name:id?companyLabel(data,id):'Entidade não definida',...pendingSummary(companyRows,today),payers:[...payers].map(([key,items])=>({key,name:key||'Pagador não informado',rows:items.sort((a,b)=>a.date.localeCompare(b.date)||a.patient.localeCompare(b.patient,'pt-BR')),...pendingSummary(items,today)})).sort((a,b)=>b.oldest-a.oldest||a.name.localeCompare(b.name,'pt-BR'))}}).sort((a,b)=>b.oldest-a.oldest||a.name.localeCompare(b.name,'pt-BR'));
}
export function pendingAction(row:BillingRow,data:BillingData){
 if(row.invoice&&activeInvoice(row.invoice))return {kind:'invoice' as const,label:'Abrir NF'};
 if(directPayment({...row,invoice:null},data,'CONVENIO'))return {kind:'payment' as const,label:'Registrar pagamento'};
 return {kind:'create' as const,label:'Criar / vincular NF'};
}
export function pendingStatus(row:BillingRow,data:BillingData){const action=pendingAction(row,data);return action.kind==='invoice'?'Aguardando pagamento':action.kind==='payment'?'Pagamento direto pendente':'Pendente sem NF';}
