import { redirect } from "next/navigation";
import { getSession } from "@/app/authz";
import { doctorHome } from "@/lib/doctor-services";
import SiteHeader from "@/components/site-header";
import OrganizationArea, { type OrganizationTab } from "@/components/organization-area";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configurações — RN Integra" };

const TABS: OrganizationTab[] = ["medicos", "equipe", "dados"];

// Configurações da organização ativa (engrenagem do menu): médicos, equipe e dados (somente gerência).
export default async function OrganizationPage({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.account.role !== "general_manager") redirect(doctorHome(session));
  const { aba } = await searchParams;
  const initialTab = TABS.find(t => t === aba) || "medicos";
  return <div className="rn-hub">
    <SiteHeader account={session.account} services={session.services} active="organization" />
    <OrganizationArea organization={session.organization} organizations={session.organizations} customer={session.customer} initialTab={initialTab} />
  </div>;
}
