export type DoctorServices={scheduling_enabled:boolean;billing_enabled:boolean;invoice_enabled:boolean};
export const noServices:DoctorServices={scheduling_enabled:false,billing_enabled:false,invoice_enabled:false};
type Access={account:{role:string;doctorId?:string|null};services?:DoctorServices};
export function doctorHome(session:Access){
 if(session.account.role==='general_manager')return '/hub';
 if(session.account.role!=='doctor')return '/dashboard';
 if(!session.account.doctorId)return '/no-services';
 const s=session.services||noServices;
 if(s.scheduling_enabled)return '/dashboard';
 if(s.billing_enabled)return '/billing';
 if(s.invoice_enabled)return '/billing?view=invoices';
 return '/no-services';
}
export function canOpenBilling(session:Access){return session.account.role==='general_manager'||(session.account.role==='doctor'&&!!session.account.doctorId&&!session.services?.scheduling_enabled&&!!(session.services?.billing_enabled||session.services?.invoice_enabled));}
export function canUseAgenda(session:Access){return session.account.role!=='doctor'||(!!session.account.doctorId&&!!session.services?.scheduling_enabled);}
