"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Field = { name: string; label: string; type?: string; autoComplete?: string; minLength?: number; maxLength?: number; placeholder?: string; defaultValue?: string; required?: boolean };

// Formulário genérico das páginas de conta: envia JSON e mostra a mensagem do servidor.
function AuthForm({ endpoint, fields, submit, extra, build, after }: {
  endpoint: string; fields: Field[]; submit: string; extra?: React.ReactNode;
  build?: (data: FormData) => Record<string, unknown>; after?: (result: Record<string, unknown>) => void;
}) {
  const [message, setMessage] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [done, setDone] = useState(false);
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const data = new FormData(event.currentTarget);
    const payload = build ? build(data) : Object.fromEntries(fields.map(f => [f.name, String(data.get(f.name) || "")]));
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.error || "Não foi possível concluir. Tente novamente."); return; }
      setMessage(result.message || "Pronto."); setDone(true); after?.(result);
    } catch { setError("Não foi possível conectar. Verifique sua internet e tente novamente."); }
    finally { setBusy(false); }
  }
  if (done) return <p role="status" className="rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message} <Link className="ml-1 font-medium underline" href="/">Ir para o login</Link></p>;
  return <form onSubmit={onSubmit} className="space-y-4">
    {fields.map(f => <div key={f.name} className="space-y-2">
      <Label htmlFor={f.name} className="text-slate-700">{f.label}</Label>
      <Input id={f.name} name={f.name} type={f.type || "text"} autoComplete={f.autoComplete} minLength={f.minLength} maxLength={f.maxLength}
        placeholder={f.placeholder} defaultValue={f.defaultValue} required={f.required !== false} className="h-12 border-slate-200 bg-slate-50/70" />
    </div>)}
    {extra}
    {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <Button type="submit" disabled={busy} className="h-12 w-full rounded-xl bg-[#12857f] text-base font-semibold hover:bg-[#0f716c]">{busy ? "Enviando…" : submit}</Button>
  </form>;
}

const password = (label = "Senha"): Field => ({ name: "password", label, type: "password", autoComplete: "new-password", minLength: 12, maxLength: 128, placeholder: "Mínimo de 12 caracteres" });

export function SignupForm() {
  return <AuthForm endpoint="/api/auth/signup" submit="Criar conta"
    fields={[{ name: "name", label: "Seu nome", autoComplete: "name", minLength: 2, maxLength: 120 },
      { name: "email", label: "E-mail", type: "email", autoComplete: "email", maxLength: 254 }, password(),
      { name: "organizationName", label: "Nome da empresa, clínica ou consultório", minLength: 2, maxLength: 120 }]}
    extra={<>
      <div className="space-y-2"><Label htmlFor="organizationKind" className="text-slate-700">Tipo</Label>
        <select id="organizationKind" name="organizationKind" defaultValue="MANAGEMENT_COMPANY" className="h-12 w-full rounded-md border border-slate-200 bg-slate-50/70 px-3 text-sm">
          <option value="MANAGEMENT_COMPANY">Empresa de gestão de agendas</option><option value="CLINIC">Clínica</option><option value="SOLO_DOCTOR">Médico autônomo</option>
        </select></div>
      <label className="flex items-start gap-2 text-sm text-slate-600"><input type="checkbox" name="acceptTerms" required className="mt-1" />
        <span>Li e aceito os <a href="/termos" target="_blank" className="underline">termos de uso</a> e a <a href="/privacidade" target="_blank" className="underline">política de privacidade</a>.</span></label>
    </>}
    build={d => ({ name: d.get("name"), email: d.get("email"), password: d.get("password"), organizationName: d.get("organizationName"), organizationKind: d.get("organizationKind"), acceptTerms: d.get("acceptTerms") === "on" })} />;
}

export function ForgotForm() {
  return <AuthForm endpoint="/api/auth/forgot" submit="Enviar link" fields={[{ name: "email", label: "E-mail da conta", type: "email", autoComplete: "email", maxLength: 254 }]} />;
}

export function ResendConfirmationForm() {
  return <AuthForm endpoint="/api/auth/resend-confirmation" submit="Enviar novo link" fields={[{ name: "email", label: "E-mail do cadastro", type: "email", autoComplete: "email", maxLength: 254 }]} />;
}

export function ResetForm({ token }: { token: string }) {
  return <AuthForm endpoint="/api/auth/reset" submit="Salvar nova senha" fields={[password("Nova senha")]}
    build={d => ({ token, password: d.get("password") })} />;
}

export function InviteAcceptForm({ token, existingUser, defaultName }: { token: string; existingUser: boolean; defaultName?: string }) {
  if (existingUser) return <AuthForm endpoint="/api/invites/accept" submit="Aceitar convite" fields={[]} build={() => ({ token })}
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    after={() => window.location.assign("/dashboard?agenda=1")} />;
  return <AuthForm endpoint="/api/invites/accept" submit="Criar acesso e aceitar"
    fields={[{ name: "name", label: "Seu nome", autoComplete: "name", minLength: 2, maxLength: 120, defaultValue: defaultName }, password("Crie uma senha")]}
    build={d => ({ token, name: d.get("name"), password: d.get("password") })} />;
}
