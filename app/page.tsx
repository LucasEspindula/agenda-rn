import { redirect } from "next/navigation";
import { getSession } from "./authz";
import { LoginForm } from "./login-form";
import { InteractiveZodiac } from "./interactive-zodiac";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (await getSession()) redirect("/dashboard");
  return <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#061224] px-5 py-10 text-[#1f2a37]">
    <InteractiveZodiac />
    <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(105deg,rgba(4,14,31,.52),rgba(4,14,31,.22)_48%,rgba(4,14,31,.62))]" />
    <section className="relative w-full max-w-md rounded-[2rem] border border-white/45 bg-white/95 p-7 shadow-[0_30px_90px_rgba(0,0,0,.42)] backdrop-blur-md sm:p-9">
      <div className="mb-9 flex items-center gap-4">
        <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
          <img src="/agenda-rn-icon.jpg" alt="Símbolo da Agenda RN" className="h-full w-full object-contain" />
        </div>
        <div><h1 className="text-2xl font-semibold tracking-tight text-[#12374f]">Agenda RN</h1><p className="mt-0.5 text-sm text-slate-500">Gestão de atendimentos</p></div>
      </div>
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Entre na sua conta</h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">Use o e-mail e a senha cadastrados pelo Gerente geral.</p>
      <LoginForm />
    </section>
  </main>;
}
