"use client";
import { useState } from "react";
import { Building2, ChevronRight } from "lucide-react";
import { organizationKindLabel } from "@/lib/organization-kinds";

type Org = { id: string; name: string; kind?: string };

// Cartões de escolha da organização (a troca é validada no servidor).
export default function OrganizationPicker({ organizations, current }: { organizations: Org[]; current: string }) {
  const [busy, setBusy] = useState<string | null>(null), [error, setError] = useState("");
  async function choose(id: string) {
    setBusy(id); setError("");
    try {
      const response = await fetch("/api/organizations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "switch", organizationId: id }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Não foi possível entrar nessa organização.");
      window.location.assign("/");
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível entrar nessa organização."); setBusy(null); }
  }
  return <div className="space-y-3">
    <ul className="space-y-3" aria-label="Suas organizações">
      {organizations.map(org => <li key={org.id}>
        <button type="button" onClick={() => void choose(org.id)} disabled={busy !== null}
          className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-[#129e98] hover:bg-[#f2fbfa] focus-visible:outline-2 focus-visible:outline-[#129e98] disabled:opacity-60">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#e6f5f3] text-[#12857f]"><Building2 size={20} aria-hidden="true" /></span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-base text-slate-900">{org.name}</strong>
            <span className="text-sm text-slate-500">{organizationKindLabel(org.kind)}{org.id === current ? " · última usada" : ""}</span>
          </span>
          <span className="text-sm text-[#12857f]">{busy === org.id ? "Entrando…" : <ChevronRight size={18} aria-hidden="true" />}</span>
        </button>
      </li>)}
    </ul>
    {error && <p role="alert" className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
  </div>;
}
