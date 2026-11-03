import "server-only";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError } from "@/lib/security/http";
import { agendaOps, changedKeys, type AgendaOp, type Base, type Key, type State } from "./diff";

export type AgendaSnapshot = { state: State; revision: string };

// Monta o mesmo JSON do antigo app_state.payload a partir das tabelas.
export async function loadAgendaState(actorId: number): Promise<AgendaSnapshot> {
  const { data, error } = await getSupabaseAdmin().rpc("load_agenda_state", { p_actor: actorId });
  dbError(error, "Read agenda");
  if (!data?.state) throw new HttpError(409, "Agenda indisponível.");
  return data as AgendaSnapshot;
}

export async function agendaRevision(actorId: number): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin().rpc("agenda_revision", { p_actor: actorId });
  dbError(error, "Read agenda revision");
  return data ? new Date(data).toISOString() : null;
}

export async function rowBases(actorId: number, revision: string, keys: Key[]): Promise<Base[]> {
  if (!keys.length) return [];
  const { data, error } = await getSupabaseAdmin().rpc("agenda_row_bases", { p_actor: actorId, p_revision: revision, p_keys: keys });
  dbError(error, "Read agenda row versions");
  return (data || []) as Base[];
}

const knownRules = [
  "Conflito de edição", "Horário indisponível", "Nota Fiscal emitida", "O paciente pertence", "O médico responsável", "Médico inexistente",
  "Configure uma agenda", "Selecione um médico", "Horário inválido", "Exclusão direta", "Histórico é imutável", "Agenda migrada",
];

export type ApplyOptions = { audit?: Array<Record<string, unknown>>; requestId?: string; decision?: "accepted" | "denied"; note?: string | null; notification?: Record<string, unknown> };

export async function applyAgendaChanges(actorId: number, ops: AgendaOp[], options: ApplyOptions = {}): Promise<{ ok: boolean; revision?: string; conflict?: string }> {
  const { data, error } = await getSupabaseAdmin().rpc("apply_agenda_changes", {
    p_actor: actorId, p_ops: ops, p_audit: options.audit || [], p_request_id: options.requestId ?? null,
    p_decision: options.decision ?? null, p_note: options.note ?? null, p_notification: options.notification ?? null,
  });
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
  const bases = await rowBases(actorId, revision, changedKeys(current, next));
  return applyAgendaChanges(actorId, agendaOps(current, next, bases), options);
}
