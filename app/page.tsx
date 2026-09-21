import { redirect } from "next/navigation";
import { getSession } from "./authz";
import { LoginForm } from "./login-form";
import { LoginScene } from "./login-scene";

import {doctorHome} from "@/lib/doctor-services";
export const dynamic = "force-dynamic";

export default async function Home() {
  const session=await getSession();if(session)redirect(doctorHome(session));
  return <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#eaf3f1] px-5 py-10 text-[#1f2a37]">
    <LoginScene />
    <section className="relative w-full max-w-md rounded-[2rem] border border-white/80 bg-white/90 p-7 shadow-[0_30px_90px_rgba(18,55,79,.14)] backdrop-blur-md sm:p-9">
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
