import Link from "next/link";
import AuthShell from "@/components/auth-shell";
import { ForgotForm } from "@/components/auth-forms";

export const metadata = { title: "Esqueci minha senha — RN Integra" };

export default function ForgotPasswordPage() {
  return <AuthShell title="Esqueci minha senha" subtitle="Informe o e-mail da sua conta. Se ele estiver cadastrado, enviaremos um link para criar uma nova senha.">
    <ForgotForm />
    <p className="mt-5 text-center text-sm text-slate-600"><Link href="/" className="underline">Voltar para o login</Link></p>
  </AuthShell>;
}
