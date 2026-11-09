"use client";
import { useCallback, useEffect, useState } from "react";
import { Building2, CalendarDays, Check, MailPlus, RefreshCw, Trash2, UserRound, X } from "lucide-react";
import InviteForm from "@/components/invite-form";
import OrganizationDoctors from "@/components/organization-doctors";
import { ORGANIZATION_KINDS, ROLE_LABELS, organizationKindLabel } from "@/lib/organization-kinds";
import AppDialog from "@/components/app-dialog";
import "./organization-area.css";

type Org = { id: string; name: string; kind?: string };
type Customer = { isOwner: boolean; maxOrganizations: number; organizationCount: number } | null;
type Member = { id: number; name: string; email: string; role: string; isOwner: boolean; isYou: boolean; since: string; agendas: number };
type Invite = { id: string; email: string; role: string; name: string | null; agendaIds: string[]; doctorId: string | null; createdAt: string; expiresAt: string; invitedBy: string | null };

const date = (value: string) => new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });

async function send(url: string, method: string, body?: unknown) {
  const response = await fetch(url, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Não foi possível concluir.");
  return result;
}

export type OrganizationTab = "medicos" | "equipe" | "dados";
const TABS: Array<[OrganizationTab, string]> = [["medicos", "Médicos"], ["equipe", "Equipe"], ["dados", "Organização"]];
type AccessUser = { id: number; email: string; name: string; role: string; updated_at: string; agendaIds: string[] };

// Área de administração (gerência): médicos, equipe com convites e dados da organização.
export default function OrganizationArea({ organization, organizations, customer, initialTab = "medicos" }: { organization: Org; organizations: Org[]; customer: Customer; initialTab?: OrganizationTab }) {
  const [tab, setTab] = useState<OrganizationTab>(initialTab);
  const [agendaEditor, setAgendaEditor] = useState<{ user: AccessUser; doctors: Array<{ id: string; name: string }>; selected: string[] } | null>(null);
  const [team, setTeam] = useState<{ members: Member[]; invites: Invite[] } | null>(null);
  const [teamError, setTeamError] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const loadTeam = useCallback(async () => {
    try { setTeam(await send("/api/organizations/team", "GET")); setTeamError(""); }
    catch (e) { setTeamError(e instanceof Error ? e.message : "Não foi possível carregar a equipe."); }
  }, []);
  useEffect(() => {
    let alive = true;
    send("/api/organizations/team", "GET").then(data => { if (alive) setTeam(data); })
      .catch(e => { if (alive) setTeamError(e instanceof Error ? e.message : "Não foi possível carregar a equipe."); });
    return () => { alive = false; };
  }, []);

  // Avisos de sucesso somem sozinhos; erros ficam até a pessoa fechar.
  useEffect(() => {
    if (notice?.kind !== "ok") return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function act(key: string, work: () => Promise<{ message?: string } | void>, after?: () => void | Promise<void>) {
    setBusy(key); setNotice(null);
    try { const result = await work(); if (result?.message) setNotice({ kind: "ok", text: result.message }); await after?.(); }
    catch (e) { setNotice({ kind: "error", text: e instanceof Error ? e.message : "Não foi possível concluir." }); }
    finally { setBusy(null); }
  }
  const reloadPage = () => window.location.assign(`/organizacao?aba=${tab}`);
  function chooseTab(next: OrganizationTab) {
    setTab(next);
    try { window.history.replaceState(null, "", `/organizacao?aba=${next}`); } catch { /* sem histórico: só troca a aba */ }
  }
  // Agendas liberadas da secretaria: lidas na hora (versão atual da conta) e gravadas pelo fluxo de acessos.
  async function openAgendas(member: Member) {
    await act(`agendas-${member.id}`, async () => {
      const [access, directory] = await Promise.all([send("/api/access", "GET"), send("/api/doctors", "GET")]);
      const user = (access.users as AccessUser[]).find(u => u.id === member.id);
      if (!user) throw new Error("Pessoa não encontrada nesta organização.");
      const doctors = (directory.doctors as Array<{ id: string; name: string; active?: boolean; scheduling_enabled?: boolean }>).filter(d => (d.active !== false && d.scheduling_enabled !== false) || user.agendaIds.includes(d.id));
      setAgendaEditor({ user, doctors, selected: user.agendaIds });
    });
  }
  async function saveAgendas() {
    if (!agendaEditor) return;
    const { user, selected } = agendaEditor;
    await act("agendas-save", async () => {
      await send("/api/access", "POST", { id: user.id, email: user.email, name: user.name || "", role: user.role, updated_at: user.updated_at, agendaIds: selected });
      return { message: "Agendas liberadas atualizadas." };
    }, async () => { setAgendaEditor(null); await loadTeam(); });
  }
  const canCreate = !!customer?.isOwner && customer.organizationCount < customer.maxOrganizations;

  return <main className="org-area">
    <header className="org-area-head">
      <span className="org-area-icon" aria-hidden="true"><Building2 size={24} /></span>
      <div><h1>Configurações</h1><p>{organization.name} · {organizationKindLabel(organization.kind)}</p></div>
    </header>
    {notice && <p className={`org-notice org-toast ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
      <span>{notice.text}</span><button type="button" onClick={() => setNotice(null)} aria-label="Fechar aviso"><X size={16} aria-hidden="true" /></button></p>}
    <nav className="org-tabs" aria-label="Configurações">
      {TABS.map(([id, label]) => <a key={id} href={`/organizacao?aba=${id}`} aria-current={tab === id ? "page" : undefined}
        onClick={e => { e.preventDefault(); chooseTab(id); }}>{label}</a>)}
    </nav>

    {tab === "medicos" && <OrganizationDoctors invites={(team?.invites || []).filter(i => i.role === "doctor")} act={act} busy={busy} onInvited={loadTeam} />}

    {tab === "dados" && <>

    <section className="org-card" aria-labelledby="org-data">
      <h2 id="org-data">Dados da organização</h2>
      <form className="org-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget);
        void act("save", () => send("/api/organizations", "PATCH", { name: String(f.get("name") || ""), kind: String(f.get("kind") || "CLINIC") }), reloadPage); }}>
        <label>Nome<input name="name" defaultValue={organization.name} required minLength={2} maxLength={120} /></label>
        <label>Tipo<select name="kind" defaultValue={organization.kind || "CLINIC"}>{ORGANIZATION_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <div><button className="org-btn primary" disabled={busy === "save"}>{busy === "save" ? "Salvando…" : "Salvar"}</button></div>
      </form>
    </section>

    <section className="org-card" aria-labelledby="org-list">
      <div className="org-card-head">
        <h2 id="org-list">Suas organizações</h2>
        {customer?.isOwner && <span className="org-muted">{customer.organizationCount} de {customer.maxOrganizations} no plano</span>}
      </div>
      <ul className="org-list">
        {organizations.map(org => <li key={org.id}>
          <div><strong>{org.name}</strong><span>{organizationKindLabel(org.kind)}</span></div>
          {org.id === organization.id ? <span className="org-badge"><Check size={14} aria-hidden="true" /> Ativa</span>
            : <button type="button" className="org-btn" disabled={busy !== null}
              onClick={() => void act(`switch-${org.id}`, () => send("/api/organizations", "POST", { action: "switch", organizationId: org.id }), reloadPage)}>
              {busy === `switch-${org.id}` ? "Entrando…" : "Entrar"}</button>}
        </li>)}
      </ul>
      {canCreate && !creating && <button type="button" className="org-btn" onClick={() => setCreating(true)}>+ Nova organização</button>}
      {creating && <form className="org-form" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget);
        void act("create", () => send("/api/organizations", "POST", { action: "create", name: String(f.get("name") || ""), kind: String(f.get("kind") || "CLINIC") }), reloadPage); }}>
        <label>Nome da nova organização<input name="name" required minLength={2} maxLength={120} autoFocus /></label>
        <label>Tipo<select name="kind" defaultValue="CLINIC">{ORGANIZATION_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <p className="org-muted">Você entra nela como gerente geral e passa a trabalhar nela em seguida.</p>
        <div><button type="button" className="org-btn" onClick={() => setCreating(false)}>Cancelar</button><button className="org-btn primary" disabled={busy === "create"}>{busy === "create" ? "Criando…" : "Criar"}</button></div>
      </form>}
      {customer?.isOwner && !canCreate && <p className="org-muted">O limite de organizações do plano foi atingido.</p>}
    </section>
    </>}

    {tab === "equipe" && <section className="org-card" aria-labelledby="org-team">
      <div className="org-card-head"><h2 id="org-team">Equipe</h2></div>
      <InviteForm organizationName={organization.name} onSent={loadTeam} />
      {teamError && <p className="org-notice error" role="alert">{teamError}</p>}
      {!team && !teamError && <p className="org-muted">Carregando equipe…</p>}
      {team && <>
        <ul className="org-members" aria-label="Membros">
          {team.members.map(m => <li key={m.id}>
            <span className="org-avatar" aria-hidden="true"><UserRound size={18} /></span>
            <div className="org-member-info">
              <strong>{m.name || m.email}{m.isYou && <em> (você)</em>}</strong>
              <span>{m.email}</span>
              <span className="org-tags"><span className="org-tag">{ROLE_LABELS[m.role] || m.role}</span>{m.isOwner && <span className="org-tag owner">Titular da conta</span>}
                {m.role === "secretary" && <span className="org-tag light">{m.agendas} agenda{m.agendas === 1 ? "" : "s"}</span>}</span>
            </div>
            {m.role === "secretary" && <button type="button" className="org-btn icon" aria-label={`Agendas liberadas para ${m.name || m.email}`} title="Agendas liberadas" disabled={busy !== null}
              onClick={() => void openAgendas(m)}><CalendarDays size={16} aria-hidden="true" /></button>}
            {!m.isYou && !m.isOwner && <button type="button" className="org-btn danger icon" aria-label={`Remover ${m.name || m.email} da organização`} title="Remover da organização" disabled={busy !== null}
              onClick={() => { if (!window.confirm(`Remover ${m.name || m.email} de ${organization.name}? A pessoa perde o acesso a esta organização na hora.`)) return;
                void act(`remove-${m.id}`, async () => { await send(`/api/access?id=${m.id}`, "DELETE"); return { message: "Acesso removido." }; }, loadTeam); }}><Trash2 size={16} aria-hidden="true" /></button>}
          </li>)}
        </ul>
        <h3>Convites pendentes</h3>
        {team.invites.length === 0 ? <p className="org-muted">Nenhum convite pendente.</p> : <ul className="org-members" aria-label="Convites pendentes">
          {team.invites.map(i => <li key={i.id}>
            <span className="org-avatar invite" aria-hidden="true"><MailPlus size={18} /></span>
            <div className="org-member-info">
              <strong>{i.name || i.email}</strong><span>{i.email}</span>
              <span className="org-tags"><span className="org-tag">{ROLE_LABELS[i.role] || i.role}</span><span className="org-tag light">vence em {date(i.expiresAt)}</span></span>
            </div>
            <div className="org-actions">
              <button type="button" className="org-btn icon" aria-label={`Reenviar convite para ${i.email}`} title="Reenviar" disabled={busy !== null}
                onClick={() => void act(`resend-${i.id}`, () => send("/api/invites", "POST", { email: i.email, role: i.role, ...(i.name ? { name: i.name } : {}),
                  ...(i.role === "secretary" ? { agendaIds: i.agendaIds } : {}), ...(i.role === "doctor" && i.doctorId ? { doctorId: i.doctorId } : {}) }), loadTeam)}><RefreshCw size={16} aria-hidden="true" /></button>
              <button type="button" className="org-btn danger icon" aria-label={`Cancelar convite para ${i.email}`} title="Cancelar convite" disabled={busy !== null}
                onClick={() => { if (!window.confirm(`Cancelar o convite para ${i.email}? O link enviado deixa de funcionar.`)) return;
                  void act(`cancel-${i.id}`, () => send(`/api/invites?id=${i.id}`, "DELETE"), loadTeam); }}><X size={16} aria-hidden="true" /></button>
            </div>
          </li>)}
        </ul>}
        <p className="org-muted">Médicos recebem acesso pela aba Médicos. Cada pessoa cria a própria senha pelo link do convite.</p>
      </>}
    </section>}

    {agendaEditor && <AppDialog label="Agendas liberadas" onClose={() => setAgendaEditor(null)} busy={busy !== null} className="org-dialog">
      <h2>Agendas liberadas</h2>
      <p className="org-muted">{agendaEditor.user.name || agendaEditor.user.email} vê e agenda somente nas agendas marcadas.</p>
      <form className="org-form" onSubmit={e => { e.preventDefault(); void saveAgendas(); }}>
        <fieldset>{agendaEditor.doctors.length ? agendaEditor.doctors.map(d => <label key={d.id}><input type="checkbox" checked={agendaEditor.selected.includes(d.id)}
          onChange={e => setAgendaEditor({ ...agendaEditor, selected: e.target.checked ? [...agendaEditor.selected, d.id] : agendaEditor.selected.filter(id => id !== d.id) })} /> {d.name}</label>)
          : <span className="org-muted">Nenhum médico com agenda cadastrado.</span>}</fieldset>
        <div><button type="button" className="org-btn" onClick={() => setAgendaEditor(null)}>Cancelar</button><button className="org-btn primary" disabled={busy !== null}>{busy === "agendas-save" ? "Salvando…" : "Salvar"}</button></div>
      </form>
    </AppDialog>}

    <footer className="org-legal"><a href="/termos">Termos de uso</a><span aria-hidden="true">·</span><a href="/privacidade">Política de privacidade</a></footer>
  </main>;
}
