"use client";
import { useEffect, useState } from "react";
import { CalendarDays, MailPlus, Pencil, Plus, Stethoscope } from "lucide-react";
import AppDialog from "@/components/app-dialog";
import { MEDICAL_SPECIALTIES } from "@/lib/medical-specialties";

type Doctor = { id: string; name: string; crm: string; specialty: string; active: boolean; scheduling_enabled: boolean; billing_enabled: boolean; invoice_enabled: boolean; updated_at: string; [key: string]: unknown };
type Agenda = { doctor_id: string; active: boolean; settings: { workStart?: string; workEnd?: string } };
type Account = { id: number; email: string; doctor_id: string | null; updated_at: string; active: boolean; agendaIds?: string[] };
type Directory = { doctors: Doctor[]; agendas: Agenda[]; accounts: Account[] };
export type DoctorInvite = { id: string; email: string; doctorId: string | null };
type Draft = Partial<Doctor>;
type Act = (key: string, work: () => Promise<{ message?: string } | void>, after?: () => void | Promise<void>) => Promise<void>;

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, cache: "no-store", headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Não foi possível concluir.");
  return result;
}
const doctorName = (name: string) => /^Dra?\.?\s/i.test(name) ? name : `Dr(a). ${name}`;
const blank: Draft = { name: "", crm: "", specialty: "", active: true, scheduling_enabled: true, billing_enabled: true, invoice_enabled: true };

// Médicos da organização: cadastro, agenda e acesso. Sem dependência do faturamento (em reconstrução).
export default function OrganizationDoctors({ invites, act, busy, onInvited }: { invites: DoctorInvite[]; act: Act; busy: string | null; onInvited: () => Promise<void> }) {
  const [data, setData] = useState<Directory | null>(null), [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null), [inviteEmail, setInviteEmail] = useState(""), [extraAgendas, setExtraAgendas] = useState<string[]>([]);
  const [dialogError, setDialogError] = useState(""), [saving, setSaving] = useState(false);

  const load = async () => { try { setData(await send("/api/doctors", "GET")); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível carregar os médicos."); } };
  useEffect(() => {
    let alive = true;
    send("/api/doctors", "GET").then(d => { if (alive) setData(d); }).catch(e => { if (alive) setError(e instanceof Error ? e.message : "Não foi possível carregar os médicos."); });
    return () => { alive = false; };
  }, []);

  const accountOf = (id?: string) => data?.accounts.find(a => a.doctor_id === id);
  const inviteOf = (id?: string) => invites.find(i => i.doctorId === id);
  const account = accountOf(draft?.id);

  function open(d: Draft) {
    const a = accountOf(d.id);
    setDraft({ ...d }); setInviteEmail(""); setExtraAgendas(a?.agendaIds?.filter(id => id !== d.id) || []); setDialogError("");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (!draft || saving) return;
    setSaving(true); setDialogError("");
    try {
      const own = account?.agendaIds?.filter(id => id !== draft.id) || [];
      const agendasChanged = !!account && JSON.stringify([...own].sort()) !== JSON.stringify([...extraAgendas].sort());
      await send("/api/doctors", "POST", { kind: "doctor", data: draft, ...(agendasChanged && account ? { access: { id: account.id, updated_at: account.updated_at, email: account.email, agendaIds: extraAgendas } } : {}) });
      setDraft(null); await load();
      await act("doctor-saved", async () => ({ message: draft.id ? "Médico atualizado." : "Médico cadastrado. Use o convite para dar acesso ao sistema." }));
    } catch (e) { setDialogError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }
  async function invite(doctor: Draft, email: string) {
    if (!doctor.id) return;
    await act(`invite-${doctor.id}`, () => send("/api/invites", "POST", { email, role: "doctor", name: doctor.name, doctorId: doctor.id }), async () => { setDraft(null); await onInvited(); });
  }
  async function setAccess(active: boolean) {
    if (!account || !draft) return;
    if (!active && !window.confirm(`Desativar o acesso de ${draft.name}? O cadastro e o histórico do médico são mantidos.`)) return;
    await act("access", async () => {
      if (active) await send("/api/access", "POST", { id: account.id, email: account.email, name: draft.name || "", role: "doctor", doctor_id: account.doctor_id, updated_at: account.updated_at, agendaIds: account.agendaIds || [], active: true });
      else await send(`/api/access?id=${account.id}`, "DELETE");
      return { message: active ? "Acesso do médico reativado." : "Acesso desativado. Cadastro e histórico preservados." };
    }, async () => { setDraft(null); await load(); });
  }

  const field = (key: "name" | "crm", label: string, required = false) =>
    <label>{label}<input required={required} maxLength={200} value={String(draft?.[key] ?? "")} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>;

  return <section className="org-card" aria-labelledby="org-doctors">
    <div className="org-card-head">
      <h2 id="org-doctors">Médicos</h2>
      <button type="button" className="org-btn primary" onClick={() => open(blank)}><Plus size={16} aria-hidden="true" /> Cadastrar médico</button>
    </div>
    <p className="org-muted">Cada médico tem a própria agenda. O acesso ao sistema é feito por convite por e-mail.</p>
    {error && <p className="org-notice error" role="alert">{error}</p>}
    {!data && !error && <p className="org-muted">Carregando médicos…</p>}
    {data && (data.doctors.length === 0 ? <p className="org-muted">Nenhum médico cadastrado ainda.</p> : <ul className="org-members" aria-label="Médicos">
      {data.doctors.map(d => {
        const a = accountOf(d.id), pending = inviteOf(d.id), agenda = data.agendas.find(x => x.doctor_id === d.id);
        return <li key={d.id}>
          <span className="org-avatar" aria-hidden="true"><Stethoscope size={18} /></span>
          <div className="org-member-info">
            <strong>{doctorName(d.name)}</strong>
            <span>{[d.specialty, d.crm].filter(Boolean).join(" · ") || "—"}</span>
            <span className="org-tags">
              {!d.active && <span className="org-tag light">Inativo</span>}
              {d.scheduling_enabled ? <span className="org-tag light">Agenda {agenda ? `${agenda.settings.workStart || "07:00"}–${agenda.settings.workEnd || "19:00"}` : "habilitada"}</span> : <span className="org-tag light">Sem agenda</span>}
              {a ? <span className={`org-tag${a.active ? " owner" : " light"}`}>{a.active ? "Com acesso" : "Acesso desativado"}</span>
                : pending ? <span className="org-tag light">Convite pendente</span> : <span className="org-tag light">Sem acesso</span>}
            </span>
          </div>
          <div className="org-actions">
            {d.scheduling_enabled && <a className="org-btn icon" href={`/organizacao/agenda?doctor_id=${encodeURIComponent(d.id)}`} aria-label={`Configurar agenda de ${d.name}`} title="Horário, regras e bloqueios"><CalendarDays size={16} aria-hidden="true" /></a>}
            <button type="button" className="org-btn icon" aria-label={`Editar ${d.name}`} title="Editar" disabled={busy !== null} onClick={() => open(d)}><Pencil size={16} aria-hidden="true" /></button>
          </div>
        </li>;
      })}
    </ul>)}

    {draft && <AppDialog label={draft.id ? "Editar médico" : "Cadastrar médico"} onClose={() => setDraft(null)} busy={saving || busy !== null} className="org-dialog">
      <h2>{draft.id ? "Editar médico" : "Cadastrar médico"}</h2>
      <form className="org-form" onSubmit={save}>
        {field("name", "Nome", true)}
        {field("crm", "CRM / UF")}
        <label>Especialidade<input list="org-medical-specialties" required value={String(draft.specialty || "")} onChange={e => setDraft({ ...draft, specialty: e.target.value })} />
          <datalist id="org-medical-specialties">{MEDICAL_SPECIALTIES.map(s => <option key={s} value={s} />)}</datalist></label>
        <p className="org-checks">
          <label><input type="checkbox" checked={!!draft.active} onChange={e => setDraft({ ...draft, active: e.target.checked })} /> Médico ativo</label>
          <label><input type="checkbox" checked={!!draft.scheduling_enabled} onChange={e => setDraft({ ...draft, scheduling_enabled: e.target.checked })} /> Agenda habilitada</label>
        </p>
        {draft.id && <div className="org-access">
          <h3>Acesso ao sistema</h3>
          {account ? <>
            <p className="org-muted">{account.active ? "Acesso ativo" : "Acesso desativado"} · {account.email}</p>
            {account.active && (data?.doctors.length || 0) > 1 && <fieldset><legend>Agendas de outros médicos que pode ver</legend>
              {data?.doctors.filter(d => d.id !== draft.id && (d.scheduling_enabled || extraAgendas.includes(d.id))).map(d =>
                <label key={d.id}><input type="checkbox" checked={extraAgendas.includes(d.id)} onChange={e => setExtraAgendas(e.target.checked ? [...extraAgendas, d.id] : extraAgendas.filter(id => id !== d.id))} /> {d.name}</label>)}
            </fieldset>}
            <button type="button" className={`org-btn${account.active ? " danger" : ""}`} disabled={busy !== null} onClick={() => void setAccess(!account.active)}>{account.active ? "Desativar acesso" : "Reativar acesso"}</button>
          </> : inviteOf(draft.id) ? <p className="org-muted">Convite pendente para {inviteOf(draft.id)?.email}. Reenvie ou cancele na aba Equipe.</p> : <>
            <p className="org-muted">Sem acesso. Envie um convite: o médico cria a própria senha pelo link.</p>
            <span className="org-invite-row">
              <input type="email" aria-label="E-mail do médico" placeholder="email@exemplo.com" maxLength={254} value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
              <button type="button" className="org-btn" disabled={busy !== null || !/^\S+@\S+\.\S+$/.test(inviteEmail)} onClick={() => void invite(draft, inviteEmail.trim())}><MailPlus size={16} aria-hidden="true" /> {busy === `invite-${draft.id}` ? "Enviando…" : "Convidar"}</button>
            </span>
          </>}
        </div>}
        {dialogError && <p className="org-notice error" role="alert">{dialogError}</p>}
        <div><button type="button" className="org-btn" disabled={saving} onClick={() => setDraft(null)}>Cancelar</button><button className="org-btn primary" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</button></div>
      </form>
    </AppDialog>}
  </section>;
}
