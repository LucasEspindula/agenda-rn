import Image from 'next/image';
import {CalendarDays,Wallet,Stethoscope,Settings} from 'lucide-react';
import HubLogout from '@/app/hub/hub-logout';
import {moduleLinks,type ModuleName} from '@/lib/navigation';
import {doctorHome,type DoctorServices} from '@/lib/doctor-services';
import '@/app/hub/hub.css';
export default function SiteHeader({account,active,services}:{services?:DoctorServices;account:{name:string;role:string;doctorId?:string|null};active?:ModuleName}){
 const session={account,services},icons={agenda:CalendarDays,billing:Wallet,doctors:Stethoscope,settings:Settings};
 return <header className="hub-header">
  <a className="hub-brand" href={doctorHome(session)} aria-label="RN Integra — início"><Image src="/agenda-rn-icon.jpg" alt="" width={42} height={42}/><div><strong>RN Integra</strong><span>Gestão de atendimentos</span></div></a>
  <nav className="hub-nav" aria-label="Módulos">{moduleLinks(session).map(link=>{const Icon=icons[link.id];return <a key={link.id} href={link.href} aria-current={active===link.id?'page':undefined}><Icon size={17} aria-hidden="true"/>{link.label}</a>})}</nav>
  <div className="hub-account"><div className="hub-avatar" aria-hidden="true">{(account.name||'U').replace(/^Dr\.?\s*/i,'').slice(0,1).toUpperCase()}</div><div className="hub-profile"><strong>{account.role==='doctor'&&!/^Dr\.?\s/i.test(account.name)?'Dr. ':''}{account.name}</strong><span>{account.role==='general_manager'?'Gerente geral':account.role==='doctor'?'Médico':'Secretaria'}</span></div>
   {account.role==='general_manager'&&<a className="hub-icon hub-settings" href="/settings" aria-current={active==='settings'?'page':undefined} aria-label="Configurações" title="Configurações"><Settings size={21} aria-hidden="true"/></a>}<HubLogout/>
  </div>
 </header>;
}
