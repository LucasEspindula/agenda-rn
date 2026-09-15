import { getSession } from "@/app/authz";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HubPage() {
  const session = await getSession();
  if (!session?.account) redirect("/");
  if (session.account.role !== "general_manager") redirect("/dashboard");
  return <main className="min-h-screen bg-slate-50 p-6 text-slate-900">
    <div className="mx-auto max-w-5xl">
      <header className="mb-10 flex items-center justify-between">
        <div><p className="text-sm font-semibold text-teal-700">RN Integra</p><h1 className="text-3xl font-semibold">Painel administrativo</h1><p className="mt-1 text-slate-600">Escolha o módulo que deseja acessar.</p></div>
        <div className="text-right text-sm"><strong>{session.account.name}</strong><p className="text-slate-500">Gerente Geral</p><a className="mt-2 inline-block text-teal-700" href="/api/auth/logout">Sair</a></div>
      </header>
      <section className="grid gap-5 md:grid-cols-2">
        <a href="/dashboard?agenda=1" className="rounded-2xl border bg-white p-7 shadow-sm transition hover:border-teal-500 hover:shadow-md"><h2 className="text-xl font-semibold">Agendamento</h2><p className="mt-2 text-slate-600">Agenda médica, pacientes, profissionais, bloqueios e solicitações.</p><span className="mt-5 inline-block font-medium text-teal-700">Abrir agenda →</span></a>
        <a href="/billing" className="rounded-2xl border bg-white p-7 shadow-sm transition hover:border-teal-500 hover:shadow-md"><h2 className="text-xl font-semibold">Faturamento</h2><p className="mt-2 text-slate-600">Pendências, cobranças particulares, convênios e notas fiscais.</p><span className="mt-5 inline-block font-medium text-teal-700">Abrir faturamento →</span></a>
      </section>
    </div>
  </main>;
}
