import Link from "next/link";
import AuthShell from "@/components/auth-shell";
import { InviteAcceptForm } from "@/components/auth-forms";
import { getSession } from "@/app/authz";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { hashEmailToken, validEmailToken } from "@/lib/email";

export const dynamic = "force-dynamic";
export const metadata = { title: "Convite — RN Integra" };
const roles: Record<string, string> = { general_manager: "gerente geral", secretary: "secretária(o)", doctor: "médico(a)" };

type Info = { email: string; role: string; name: string | null; organization: string; existingUser: boolean };

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const info = validEmailToken(token) ? (await getSupabaseAdmin().rpc("invite_info", { p_token_hash: hashEmailToken(token) })).data as Info | null : null;
  if (!info || !token) return <AuthShell title="Convite inválido ou expirado" subtitle="Peça para a gerência enviar um novo convite."><Link href="/" className="underline">Ir para o login</Link></AuthShell>;
  const subtitle = `Você foi convidado(a) para ${info.organization} como ${roles[info.role] || info.role}, com o e-mail ${info.email}.`;
  if (info.existingUser) {
    const session = await getSession();
    if (session?.account.email.toLowerCase() !== info.email) return <AuthShell title="Aceitar convite" subtitle={subtitle}>
      <p className="text-sm text-slate-600">Você já tem conta com este e-mail. Entre com ela e abra este link de novo para aceitar.</p>
      <Link href="/" className="mt-4 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#12857f] font-semibold text-white">Entrar</Link>
    </AuthShell>;
    return <AuthShell title="Aceitar convite" subtitle={subtitle}><InviteAcceptForm token={token} existingUser /></AuthShell>;
  }
  return <AuthShell title="Aceitar convite" subtitle={subtitle}><InviteAcceptForm token={token} existingUser={false} defaultName={info.name ?? undefined} /></AuthShell>;
}
