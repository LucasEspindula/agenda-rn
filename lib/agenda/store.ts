import "server-only";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError } from "@/lib/security/http";
import { agendaOps, changedKeys, type AgendaOp, type Base, type Key, type State } from "./diff";
import { mergeAgendaDelta } from "./delta";

export type AgendaSnapshot = { state: State; revision: string };

// Monta o mesmo JSON do antigo app_state.payload a partir das tabelas.
// `org` = organização ativa da sessão; o banco confere o vínculo do usuário com ela.
const withOrg = <T extends Record<string, unknown>>(args: T, org?: string) => (org ? { ...args, p_org: org } : args);

export async function loadAgendaState(actorId: number, org?: string): Promise<AgendaSnapshot> {
  return cachedSnapshot(org, "all", actorId, async () => {
    const { data, error } = await getSupabaseAdmin().rpc("load_agenda_state", withOrg({ p_actor: actorId }, org));
    dbError(error, "Read agenda");
    if (!data?.state) throw new HttpError(409, "Agenda indisponível.");
    return data as AgendaSnapshot;
  });
}

// Cache por revisão: montar a agenda é a consulta mais cara do banco e, com várias abas abertas,
// cada alteração fazia todas recarregarem o mesmo resultado. Agora a primeira aba de uma revisão
// lê do banco; as demais reaproveitam enquanto a revisão for a mesma. Leituras simultâneas
// esperam a mesma consulta. A revisão é conferida no banco a cada chamada (agenda_revision com
// p_org também confere o vínculo do usuário com a organização), e o filtro por papel continua
// sendo aplicado depois, por usuário. Sem organização explícita, não há cache.
// Revisão nova (ou cache vencido): em vez de remontar tudo, pede ao banco só o que mudou desde a
// revisão em memória (load_agenda_delta) e aplica por cima. A cada FULL_RELOAD_MS, ou se o
// incremental falhar ou vier incompleto, relê a agenda inteira.
const SNAPSHOT_TTL_MS = 30_000;
const SNAPSHOT_MAX = 24;
const FULL_RELOAD_MS = 10 * 60_000;
type CachedSnapshot = { revision: number; text: string; at: number; fullAt: number };
const snapshotCache = new Map<string, CachedSnapshot>();
const snapshotLoads = new Map<string, Promise<AgendaSnapshot>>();
const revisionTime = (value: unknown) => { const t = Date.parse(String(value ?? "")); return Number.isFinite(t) ? t : NaN; };
function rememberSnapshot(key: string, snapshot: AgendaSnapshot, fullAt: number) {
  const revision = revisionTime(snapshot.revision);
  if (!Number.isFinite(revision)) return;
  const previous = snapshotCache.get(key);
  if (previous && previous.revision > revision) return;
  snapshotCache.delete(key);
  snapshotCache.set(key, { revision, text: JSON.stringify(snapshot), at: Date.now(), fullAt });
  while (snapshotCache.size > SNAPSHOT_MAX) snapshotCache.delete(snapshotCache.keys().next().value as string);
}
// Cada chamador recebe sua própria cópia: rotas alteram o estado antes de gravar.
async function cachedSnapshot(org: string | undefined, scope: string, actorId: number, load: () => Promise<AgendaSnapshot>): Promise<AgendaSnapshot> {
  if (!org) return load();
  const key = `${org}|${scope}`;
  const current = revisionTime(await agendaRevision(actorId, org));
  const hit = snapshotCache.get(key);
  if (hit && hit.revision === current && Date.now() - hit.at < SNAPSHOT_TTL_MS) return JSON.parse(hit.text) as AgendaSnapshot;
  const shared = snapshotLoads.get(key);
  if (shared) {
    const snapshot = await shared.catch(() => null);
    // Só aproveita a leitura em andamento se ela já enxerga a revisão vista acima.
    if (snapshot && revisionTime(snapshot.revision) >= current) return JSON.parse(JSON.stringify(snapshot)) as AgendaSnapshot;
  }
  const base = hit && Date.now() - hit.fullAt < FULL_RELOAD_MS ? hit : null;
  const since = scope === "all" ? null : scope;
  const pending = (base ? refreshSnapshot(base, since, actorId, org, load) : load().then(snapshot => ({ snapshot, fullAt: Date.now() })))
    .then(({ snapshot, fullAt }) => { rememberSnapshot(key, snapshot, fullAt); return snapshot; });
  snapshotLoads.set(key, pending);
  try {
    const snapshot = await pending;
    return JSON.parse(JSON.stringify(snapshot)) as AgendaSnapshot;
  } finally {
    if (snapshotLoads.get(key) === pending) snapshotLoads.delete(key);
  }
}

async function refreshSnapshot(base: CachedSnapshot, since: string | null, actorId: number, org: string, load: () => Promise<AgendaSnapshot>) {
  try {
    const delta = await loadAgendaDelta(actorId, since, new Date(base.revision).toISOString(), org);
    const merged = mergeAgendaDelta(JSON.parse(base.text) as AgendaSnapshot, delta);
    if (merged) return { snapshot: merged as AgendaSnapshot, fullAt: base.fullAt };
  } catch {
    // Incremental indisponível: segue para a leitura completa, que reporta o erro se houver.
  }
  return { snapshot: await load(), fullAt: Date.now() };
}

async function loadAgendaDelta(actorId: number, since: string | null, after: string, org: string): Promise<unknown> {
  const { data, error } = await getSupabaseAdmin().rpc("load_agenda_delta", withOrg({ p_actor: actorId, p_since: since, p_after: after }, org));
  dbError(error, "Read agenda changes");
  return data;
}

// Janela padrão enviada ao navegador: 90 dias para trás (fuso de São Paulo) e todo o futuro.
export const AGENDA_WINDOW_DAYS = 90;
export function defaultAgendaSince(now = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - AGENDA_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}
// "all" = agenda completa; data AAAA-MM-DD válida = a partir dela; qualquer outra coisa = janela padrão.
export function parseAgendaSince(value: string | null, now = new Date()): string | null {
  if (value === "all") return null;
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value) return value;
  return defaultAgendaSince(now);
}

// Agenda para o navegador a partir de `since` (null = completa).
export async function loadAgendaWindow(actorId: number, since: string | null, org?: string): Promise<AgendaSnapshot> {
  return cachedSnapshot(org, since ?? "all", actorId, async () => {
    const { data, error } = await getSupabaseAdmin().rpc("load_agenda_window", withOrg({ p_actor: actorId, p_since: since }, org));
    dbError(error, "Read agenda");
    if (!data?.state) throw new HttpError(409, "Agenda indisponível.");
    return data as AgendaSnapshot;
  });
}

export async function agendaRevision(actorId: number, org?: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().rpc("agenda_revision", withOrg({ p_actor: actorId }, org));
  dbError(error, "Read agenda revision");
  return data ? new Date(data).toISOString() : null;
}

export async function rowBases(actorId: number, revision: string, keys: Key[], org?: string): Promise<Base[]> {
  if (!keys.length) return [];
  const { data, error } = await getSupabaseAdmin().rpc("agenda_row_bases", withOrg({ p_actor: actorId, p_revision: revision, p_keys: keys }, org));
  dbError(error, "Read agenda row versions");
  return (data || []) as Base[];
}

const knownRules = [
  "Conflito de edição", "Horário indisponível", "Nota Fiscal emitida", "O paciente pertence", "O médico responsável", "Médico inexistente",
  "Configure uma agenda", "Selecione um médico", "Horário inválido", "Exclusão direta", "Histórico é imutável", "Agenda migrada",
];

export type ApplyOptions = { audit?: Array<Record<string, unknown>>; requestId?: string; decision?: "accepted" | "denied"; note?: string | null; notification?: Record<string, unknown>; org?: string };

export async function applyAgendaChanges(actorId: number, ops: AgendaOp[], options: ApplyOptions = {}): Promise<{ ok: boolean; revision?: string; conflict?: string }> {
  const { data, error } = await getSupabaseAdmin().rpc("apply_agenda_changes", withOrg({
    p_actor: actorId, p_ops: ops, p_audit: options.audit || [], p_request_id: options.requestId ?? null,
    p_decision: options.decision ?? null, p_note: options.note ?? null, p_notification: options.notification ?? null,
  }, options.org));
  if (error) {
    const message = String(error.message || "");
    if (error.code === "23505") throw new HttpError(409, message.includes("patients_owner_cpf_key") ? "CPF já cadastrado para este médico." : "Registro duplicado.");
    if (error.code === "23514" || error.code === "22P02" || error.code === "22007" || error.code === "22008") throw new HttpError(400, "Dados da agenda inválidos.");
    if (error.code === "23503") throw new HttpError(409, "Registro relacionado inexistente. Atualize a agenda.");
    if (knownRules.some(rule => message.includes(rule))) throw new HttpError(409, message);
    dbError(error, "Save agenda");
  }
  return data as { ok: boolean; revision?: string; conflict?: string };
}

// Grava a diferença entre dois estados completos já autorizados pelo chamador.
export async function commitAgendaState(actorId: number, revision: string, current: State, next: State, options: ApplyOptions = {}) {
  const bases = await rowBases(actorId, revision, changedKeys(current, next), options.org);
  return applyAgendaChanges(actorId, agendaOps(current, next, bases), options);
}
