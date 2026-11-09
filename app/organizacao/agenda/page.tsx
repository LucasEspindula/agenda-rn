import { redirect } from "next/navigation";
import { getSession } from "@/app/authz";
import { doctorHome } from "@/lib/doctor-services";
import SiteHeader from "@/components/site-header";
import AgendaSettings from "./agenda-settings";
import { LegacyApp } from "@/app/dashboard/legacy-app";
import "@/app/billing/billing.css";
import "@/components/organization-area.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agenda do médico — RN Integra" };

// Horário, regras e bloqueios da agenda de um médico (somente gerência).
export default async function DoctorAgendaPage({ searchParams }: { searchParams: Promise<{ doctor_id?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/");
  if (session.account.role !== "general_manager") redirect(doctorHome(session));
  const { doctor_id } = await searchParams;
  if (!doctor_id) redirect("/organizacao?aba=medicos");
  return <div className="rn-hub rn-agenda settings-module admin-module">
    <SiteHeader account={session.account} services={session.services} active="organization" />
    <div className="org-back"><a href="/organizacao?aba=medicos">← Médicos</a></div>
    <AgendaSettings doctorId={doctor_id} />
    <LegacyApp initialView="settings" adminSection="rules" doctorId={doctor_id} />
  </div>;
}
