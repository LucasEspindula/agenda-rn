import { redirect } from "next/navigation";
import { getSession } from "@/app/authz";
import { doctorHome } from "@/lib/doctor-services";
import SiteHeader from "@/components/site-header";
import OrganizationArea from "@/components/organization-area";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organização — RN Integra" };

// Área da organização ativa: dados, organizações da conta e equipe (somente gerência).
export default async function OrganizationPage() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.account.role !== "general_manager") redirect(doctorHome(session));
  return <div className="rn-hub">
    <SiteHeader account={session.account} services={session.services} active="organization" />
    <OrganizationArea organization={session.organization} organizations={session.organizations} customer={session.customer} />
  </div>;
}
