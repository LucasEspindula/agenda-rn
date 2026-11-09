import { redirect } from "next/navigation";
import AuthShell from "@/components/auth-shell";
import OrganizationPicker from "@/components/organization-picker";
import { getSession } from "@/app/authz";
import { doctorHome } from "@/lib/doctor-services";
import { ROLE_LABELS } from "@/lib/organization-kinds";

export const dynamic = "force-dynamic";
export const metadata = { title: "Escolha a organização — RN Integra" };

// Lobby depois do login para quem trabalha em mais de uma organização.
export default async function OrganizationLobby() {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.organizations.length < 2) redirect(doctorHome(session));
  return <AuthShell title="Em qual organização você vai trabalhar?" subtitle={`Você entra como ${ROLE_LABELS[session.account.role].toLowerCase()}. Dá para trocar depois pelo seletor no topo.`}>
    <OrganizationPicker organizations={session.organizations} current={session.organization.id} />
  </AuthShell>;
}
