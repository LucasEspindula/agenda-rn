import {BILLING_PAUSED} from './billing-paused';
import {canOpenBilling,canOpenInvoices,canUseAgenda,type DoctorServices} from './doctor-services';
export type ModuleName='agenda'|'billing'|'denials'|'doctors'|'settings';
type Identity={account:{role:string;doctorId?:string|null};services?:DoctorServices};
export function moduleLinks(session:Identity){
 const links:{id:ModuleName;href:string;label:string}[]=[];
 if(canUseAgenda(session))links.push({id:'agenda',href:'/dashboard?agenda=1',label:'Agendamento'});
 if(canOpenBilling(session))links.push({id:'billing',href:session.account.role==='doctor'&&!session.services?.billing_enabled?'/billing?view=invoices':'/billing',label:session.account.role==='doctor'&&!session.services?.billing_enabled?'Notas fiscais':'Faturamento'});
 else if(!BILLING_PAUSED&&session.account.role==='secretary'&&process.env.RN_PORTAL_SUBMISSIONS_ENABLED==='true')links.push({id:'billing',href:'/billing/portal',label:'Guias de convênio'});
 else if(canOpenInvoices(session))links.push({id:'billing',href:'/billing?view=invoices',label:'Notas fiscais'});
 if(!BILLING_PAUSED&&session.account.role==='secretary'&&process.env.RN_DENIALS_ENABLED==='true')
   links.push({id:'denials',href:'/billing/glosas',label:'Glosas'});
 if(session.account.role==='general_manager')links.push({id:'doctors',href:'/doctors',label:'Cadastros'});
 return links;
}
