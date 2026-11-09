import Link from "next/link";
import AuthShell from "@/components/auth-shell";
import { ResendConfirmationForm } from "@/components/auth-forms";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { hashEmailToken, validEmailToken } from "@/lib/email";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmar e-mail — RN Integra" };

// O link do e-mail confirma o endereço (uso único, 48 horas).
export default async function ConfirmEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  let ok = false;
  if (validEmailToken(token)) {
    const result = await getSupabaseAdmin().rpc("confirm_email", { p_token_hash: hashEmailToken(token) });
    ok = !result.error;
  }
  if (ok) return <AuthShell title="E-mail confirmado" subtitle="Sua conta está ativa. Entre com seu e-mail e senha."><Link href="/" className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#12857f] font-semibold text-white">Entrar</Link></AuthShell>;
  return <AuthShell title="Link inválido ou expirado" subtitle="O link de confirmação vale por 48 horas e só pode ser usado uma vez. Peça um novo abaixo."><ResendConfirmationForm /></AuthShell>;
}
