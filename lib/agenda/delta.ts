import type { State } from "./diff";

// Sincronização incremental: o banco devolve só as linhas alteradas desde uma revisão conhecida
// (load_agenda_delta) e a ordem completa dos ids de cada lista. Aqui a diferença é aplicada sobre a
// agenda que já está em memória. Se faltar qualquer linha (por exemplo, um item que entrou na janela
// sem ter sido alterado), devolve null e quem chamou relê a agenda completa: nunca adivinha.
export const DELTA_LISTS = ["hospitals", "patients", "appointments", "cancelledAppointments", "patientHistory"] as const;
type Row = Record<string, unknown>;
export type AgendaDelta = { revision: string; delta: true; order: Record<(typeof DELTA_LISTS)[number], unknown[]>; state: State };

export function mergeAgendaDelta(base: { state: State; revision: string }, delta: unknown): { state: State; revision: string } | null {
  const d = delta as Partial<AgendaDelta> | null;
  if (!d || d.delta !== true || !d.order || !d.state || typeof d.revision !== "string") return null;
  const state: State = { ...d.state };
  for (const list of DELTA_LISTS) {
    const ids = d.order[list];
    if (!Array.isArray(ids)) return null;
    const rows = new Map<string, Row>();
    for (const row of (base.state[list] || []) as Row[]) rows.set(String(row.id), row);
    for (const row of (d.state[list] || []) as Row[]) rows.set(String(row.id), row);
    const next: Row[] = [];
    for (const id of ids) {
      const row = rows.get(String(id));
      if (!row) return null;
      next.push(row);
    }
    state[list] = next;
  }
  return { state, revision: d.revision };
}
