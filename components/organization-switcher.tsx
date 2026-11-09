"use client";
import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";

type Org = { id: string; name: string; kind?: string };
type Customer = { isOwner: boolean; maxOrganizations: number; organizationCount: number } | null;
const kinds: Array<[string, string]> = [["MANAGEMENT_COMPANY", "Empresa de gestão"], ["CLINIC", "Clínica"], ["SOLO_DOCTOR", "Médico autônomo"]];

// Organização ativa da sessão. Aparece quando a pessoa tem mais de uma organização
// ou é titular da conta (pode criar outra). A troca é validada no servidor.
export default function OrganizationSwitcher() {
  const [data, setData] = useState<{ organization: Org; organizations: Org[]; customer: Customer } | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/organizations", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(d => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data) return null;
  const canCreate = !!data.customer?.isOwner && data.customer.organizationCount < data.customer.maxOrganizations;
  if (data.organizations.length < 2 && !canCreate) return null;

  async function send(payload: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/organizations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível concluir.");
      // Recarga completa de propósito: a agenda legada guarda estado global na página,
      // e permissões e menus passam a ser da organização escolhida.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/dashboard?agenda=1");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível concluir."); setBusy(false); }
  }

  return <div className="org-switcher">
    <Building2 size={16} aria-hidden="true" />
    <label className="sr-only" htmlFor="orgSwitcher">Organização</label>
    <select id="orgSwitcher" value={data.organization.id} disabled={busy}
      onChange={e => { if (e.target.value === "__new") { setCreating(true); return; } if (e.target.value !== data.organization.id) void send({ action: "switch", organizationId: e.target.value }); }}>
      {data.organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      {canCreate && <option value="__new">+ Nova organização…</option>}
    </select>
    {creating && <form className="org-create" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void send({ action: "create", name: String(f.get("name") || ""), kind: String(f.get("kind") || "CLINIC") }); }}>
      <strong>Nova organização</strong>
      <input name="name" required minLength={2} maxLength={120} placeholder="Nome" autoFocus />
      <select name="kind" defaultValue="CLINIC">{kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      {error && <span className="org-error" role="alert">{error}</span>}
      <div><button type="button" className="secondary-btn" onClick={() => { setCreating(false); setError(""); }}>Cancelar</button><button className="primary-btn" disabled={busy}>Criar</button></div>
    </form>}
    {!creating && error && <span className="org-error" role="alert">{error}</span>}
  </div>;
}
