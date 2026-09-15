import { getSession } from "@/app/authz";
import { redirect } from "next/navigation";
import Image from "next/image";
import HubLogout from "./hub-logout";
import "./hub.css";

export const dynamic = "force-dynamic";

export default async function HubPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.account.role !== "general_manager") redirect("/dashboard");
  return <div className="rn-hub">
    <header className="hub-header">
      <a className="hub-brand" href="/hub" aria-label="RN Integra — início">
        <Image src="/agenda-rn-icon.jpg" alt="" width={42} height={42}/>
        <div><strong>RN Integra</strong><span>Gestão de atendimentos</span></div>
      </a>
      <nav className="hub-nav" aria-label="Módulos">
        <a href="/dashboard?agenda=1"><span aria-hidden="true">▦</span> Agendamento</a>
        <a href="/billing"><span aria-hidden="true">☷</span> Faturamento</a>
      </nav>
      <div className="hub-account">
        <div className="hub-avatar" aria-hidden="true">{(session.account.name || "G").slice(0,1).toUpperCase()}</div>
        <div className="hub-profile"><strong>{session.account.name}</strong><span>Gerente geral</span></div>
        <a className="hub-icon hub-settings" href="/dashboard?agenda=1#settings" aria-label="Configurações" title="Configurações">⚙</a>
        <HubLogout/>
      </div>
    </header>
    <main className="hub-content">
      <h1>Bem-vindo ao RN Integra</h1>
      <p>Selecione Agendamento ou Faturamento no menu superior.</p>
    </main>
  </div>;
}
