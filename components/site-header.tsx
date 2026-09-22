import Image from "next/image";
import HubLogout from "@/app/hub/hub-logout";
import "@/app/hub/hub.css";
export default function SiteHeader({account,active,services}:{services?:{scheduling_enabled:boolean;invoice_enabled?:boolean};account:{name:string;role:string};active?:"billing"}) {return (<header className="hub-header">
      <a className="hub-brand" href={account.role === "general_manager" ? "/hub" : "/dashboard"} aria-label="RN Integra — início">
        <Image src="/agenda-rn-icon.jpg" alt="" width={42} height={42}/>
        <div><strong>RN Integra</strong><span>Gestão de atendimentos</span></div>
      </a>
      <nav className="hub-nav" aria-label="Módulos">
        {(account.role!=='doctor'||services?.scheduling_enabled)&&<a href="/dashboard?agenda=1"><span aria-hidden="true">▦</span> Agendamento</a>}
        {(account.role!=='doctor'||!services?.scheduling_enabled)&&<a href="/billing" aria-current={active === "billing" ? "page" : undefined}><span aria-hidden="true">☷</span> Faturamento</a>}
        {account.role==='doctor'&&services?.scheduling_enabled&&services?.invoice_enabled&&<a href="/billing?view=invoices" aria-current={active==='billing'?'page':undefined}>Notas fiscais</a>}
      </nav>
      <div className="hub-account">
        <div className="hub-avatar" aria-hidden="true">{(account.name || "G").slice(0,1).toUpperCase()}</div>
        <div className="hub-profile"><strong>{account.role==='doctor'&&!/^Dr\.?\s/i.test(account.name)?'Dr. ':''}{account.name}</strong><span>{account.role === "general_manager" ? "Gerente geral" : account.role==="doctor"?"Médico":"Secretaria"}</span></div>
        {account.role!=='doctor'&&<a className="hub-icon hub-settings" href="/dashboard?agenda=1#settings" aria-label="Configurações" title="Configurações">⚙</a>}
        <HubLogout/>
      </div>
    </header>);}
