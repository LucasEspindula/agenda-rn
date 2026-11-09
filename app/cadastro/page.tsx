import Link from "next/link";
import AuthShell from "@/components/auth-shell";
import { SignupForm } from "@/components/auth-forms";
import { publicSignupEnabled } from "@/lib/legal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Criar conta — RN Integra" };

export default function SignupPage() {
  if (!publicSignupEnabled()) return <AuthShell title="Cadastro em breve" subtitle="O cadastro pelo site ainda não está aberto. Fale com a equipe RN Integra para contratar."><Link href="/" className="text-sm underline">Voltar para o login</Link></AuthShell>;
  return <AuthShell title="Criar conta" subtitle="Você será o titular da conta e gerente geral da sua organização. Depois, convide sua equipe.">
    <SignupForm />
    <p className="mt-5 text-center text-sm text-slate-600">Já tem conta? <Link href="/" className="font-medium underline">Entrar</Link></p>
  </AuthShell>;
}
