import { getSession } from "@/app/authz";
import { redirect } from "next/navigation";
import SiteHeader from "@/components/site-header";
import "./hub.css";

export const dynamic = "force-dynamic";

export default async function HubPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.account.role !== "general_manager") redirect("/dashboard");
  return <div className="rn-hub">
    <SiteHeader account={session.account}/>
    <main className="hub-content">
      <h1>Bem-vindo ao RN Integra</h1>
      <p>Selecione Agendamento ou Faturamento no menu superior.</p>
    </main>
  </div>;
}
