import AuthShell from "@/components/auth-shell";
import { ResetForm } from "@/components/auth-forms";
import { validEmailToken } from "@/lib/email";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nova senha — RN Integra" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!validEmailToken(token)) return <AuthShell title="Link inválido" subtitle="Peça um novo link em “Esqueci minha senha”."><a href="/esqueci-senha" className="underline">Pedir novo link</a></AuthShell>;
  return <AuthShell title="Criar nova senha" subtitle="A senha precisa ter pelo menos 12 caracteres. Ao salvar, as sessões abertas são encerradas.">
    <ResetForm token={token} />
  </AuthShell>;
}
