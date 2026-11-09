"use client";
import { useEffect, useState } from "react";
import { MailPlus } from "lucide-react";

type Doctor = { id: string; name: string; specialty?: string; active?: boolean };
const roles: Array<[string, string]> = [["secretary", "Secretária(o)"], ["doctor", "Médico(a)"], ["general_manager", "Gerente geral"]];

// Convite por e-mail para a organização ativa (página Organização, só gerência).
export default function InviteForm({ organizationName, onSent }: { organizationName: string; onSent?: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false), [doctors, setDoctors] = useState<Doctor[]>([]), [role, setRole] = useState("secretary");
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  useEffect(() => {
    if (!open || doctors.length) return;
    fetch("/api/doctors", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(d => setDoctors(((d?.doctors || []) as Doctor[]).filter(x => x.active !== false))).catch(() => {});
  }, [open, doctors.length]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    const f = new FormData(event.currentTarget), form = event.currentTarget;
    const payload: Record<string, unknown> = { email: String(f.get("email") || ""), name: String(f.get("name") || "") || undefined, role };
    if (role === "secretary") payload.agendaIds = f.getAll("agendaIds").map(String);
    if (role === "doctor") payload.doctorId = String(f.get("doctorId") || "");
    try {
      const response = await fetch("/api/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível enviar o convite.");
      setMessage(result.message || "Convite enviado."); form.reset(); setRole("secretary"); await onSent?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível enviar o convite."); }
    finally { setBusy(false); }
  }
  return <section className="invite-panel">
    <button type="button" className="secondary-btn org-btn invite-toggle" onClick={() => setOpen(v => !v)} aria-expanded={open}><MailPlus size={16} aria-hidden="true" /> Convidar por e-mail</button>
    {open && <form className="invite-form" onSubmit={submit}>
      <p>O convite vale por 7 dias e dá acesso a <strong>{organizationName}</strong>.</p>
      <label>E-mail<input name="email" type="email" required maxLength={254} /></label>
      <label>Nome (opcional)<input name="name" maxLength={120} /></label>
      <label>Papel<select value={role} onChange={e => setRole(e.target.value)}>{roles.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {role === "doctor" && <label>Médico<select name="doctorId" required defaultValue=""><option value="" disabled>Selecione</option>{doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>}
      {role === "secretary" && <fieldset><legend>Agendas liberadas</legend>{doctors.length ? doctors.map(d => <label key={d.id} className="invite-check"><input type="checkbox" name="agendaIds" value={d.id} /> {d.name}</label>) : <span>Nenhum médico cadastrado.</span>}</fieldset>}
      {error && <p className="invite-error" role="alert">{error}</p>}
      {message && <p className="invite-ok" role="status">{message}</p>}
      <div><button type="button" className="secondary-btn org-btn" onClick={() => setOpen(false)}>Fechar</button><button className="primary-btn org-btn primary" disabled={busy}>{busy ? "Enviando…" : "Enviar convite"}</button></div>
    </form>}
  </section>;
}
