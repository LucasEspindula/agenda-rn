import {NavIcon} from '@/components/billing-icons';
import {getSession} from '@/app/authz';
import {redirect} from 'next/navigation';
import SiteHeader from '@/components/site-header';
import DoctorDirectory from './doctor-directory';
import AgendaSettings from './agenda-settings';
import BillingClient from '@/app/billing/billing-client';
import {LegacyApp} from '@/app/dashboard/legacy-app';
import '@/app/billing/billing.css';
export const dynamic='force-dynamic';
export default async function DoctorsPage({searchParams}:{searchParams:Promise<{view?:string;doctor_id?:string}>}){
 const session=await getSession();if(!session||session.account.role!=='general_manager')redirect('/dashboard');
 const {view='doctors',doctor_id}=await searchParams,legacy=view==='hospitals'||view==='agenda'&&!!doctor_id;
 return <div className={'rn-hub'+(legacy?' rn-agenda settings-module admin-module':'')}><SiteHeader account={session.account} services={session.services} active="doctors"/><div className="billing-subnav"><nav aria-label="Cadastro central">{[['doctors','Médicos'],['hospitals','Hospitais'],['companies','Empresas e vínculos']].map(([id,label])=><a key={id} href={id==='doctors'?'/doctors':'/doctors?view='+id} aria-current={(view===id||id==='doctors'&&view==='agenda')?'page':undefined}><NavIcon kind={id}/>{label}</a>)}</nav></div>{view==='companies'?<BillingClient administration/>:view==='hospitals'?<LegacyApp initialView="settings" adminSection="hospitals"/>:view==='agenda'&&doctor_id?<><AgendaSettings doctorId={doctor_id}/><LegacyApp initialView="settings" adminSection="rules" doctorId={doctor_id}/></>:<DoctorDirectory/>}</div>
}

