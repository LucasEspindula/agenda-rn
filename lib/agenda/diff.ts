// Conversão entre o documento legado (enviado inteiro pelo legacy-app.js) e
// operações por registro nas tabelas da agenda, com merge de três vias:
// base = versão que o cliente leu, atual = banco, proposta = envio.
import { HttpError } from '../security/http';

// Legacy agenda rows are heterogeneous JSON objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type State = Record<string, any>;
export type Entity = 'patients' | 'appointments' | 'hospitals' | 'scheduleBlocks' | 'schedulingRules';
export type Key = { entity: Entity; id: string };
export type Base = { entity: Entity; id: string; currentVersion: number | null; baseVersion: number | null; base: Row | null };
export type AgendaOp = { op: string; id?: string; data?: Row; expectedVersion?: number | null; cancelled?: boolean };

export const entities: Entity[] = ['hospitals', 'patients', 'appointments', 'scheduleBlocks', 'schedulingRules'];
// Pacientes e consultas nunca são removidos por ausência; demais entidades de
// configuração têm a ausência convertida em operação explícita.
const removable = new Set<Entity>(['hospitals', 'scheduleBlocks', 'schedulingRules']);

const text = (v: unknown) => v == null ? '' : String(v).trim();
const optional = (v: unknown) => { const t = text(v); return t ? t : null; };
const instant = (v: unknown) => { if (v == null || v === '') return null; const t = Date.parse(String(v)); return Number.isFinite(t) ? t : String(v); };
const times = (v: unknown) => text(v).split(',').map(t => t.trim()).filter(Boolean).join(',');

export function canonical(entity: Entity, row: Row, cancelled = false): string {
  switch (entity) {
    case 'patients': {
      const newborn = row.newborn === true;
      return JSON.stringify([row.id, text(row.doctorId), text(row.name), text(row.cpf).replace(/\D/g, ''), text(row.phone), text(row.email), text(row.insurance), text(row.cardNumber),
        text(row.address), text(row.addressZip), text(row.addressNumber), text(row.addressComplement), text(row.addressNeighborhood), text(row.addressCity), text(row.addressState).toUpperCase(),
        newborn, newborn ? text(row.guardianName) : '']);
    }
    case 'appointments':
      return JSON.stringify([row.id, text(row.doctorId), text(row.anesthetistId), text(row.patientId), text(row.hospitalId), text(row.date), text(row.time), Number(row.duration),
        text(row.status), text(row.careType) || 'outpatient', text(row.procedure) || 'Procedimento', row.insurance == null ? null : String(row.insurance), optional(row.forma_cobranca),
        text(row.guideExpiry), !!row.opme, !!row.reports, !!row.exams, text(row.notes), instant(row.statusUpdatedAt), text(row.rescheduleReason), text(row.suggestionReason),
        optional(row.suggestedByName), optional(row.suggestedByEmail),
        (Array.isArray(row.rescheduleHistory) ? row.rescheduleHistory : []).map((r: Row) => [text(r.fromDate), text(r.fromTime), text(r.toDate), text(r.toTime), text(r.reason), text(r.proposedBy), text(r.createdAt)]),
        cancelled, cancelled ? instant(row.cancelledAt) : null, cancelled ? (text(row.cancelReason) || 'Não informado') : null]);
    case 'hospitals':
      return JSON.stringify([row.id, text(row.name), text(row.abbreviation)]);
    case 'scheduleBlocks':
      return JSON.stringify([row.id, text(row.professionalId), text(row.date), text(row.start), text(row.end), text(row.reason)]);
    case 'schedulingRules':
      return JSON.stringify([row.id, text(row.professionalId), optional(row.hospitalId), text(row.name), text(row.severity) || 'preference', text(row.weekday), text(row.occurrence),
        text(row.start), text(row.end), row.maxPatients == null || row.maxPatients === '' ? null : Number(row.maxPatients), text(row.procedureContains),
        times(row.preferredTimes), times(row.forbiddenTimes), !!row.blockAllDay, row.enabled !== false]);
  }
}

type Entry = { row: Row; cancelled: boolean };
export function rowsOf(state: State | null | undefined, entity: Entity): Map<string, Entry> {
  const map = new Map<string, Entry>();
  if (!state) return map;
  if (entity === 'appointments') {
    for (const row of state.appointments || []) map.set(String(row.id), { row, cancelled: false });
    for (const row of state.cancelledAppointments || []) map.set(String(row.id), { row, cancelled: true });
  } else for (const row of state[entity] || []) map.set(String(row.id), { row, cancelled: false });
  return map;
}
const same = (entity: Entity, a?: Entry, b?: Entry) => !!a && !!b && canonical(entity, a.row, a.cancelled) === canonical(entity, b.row, b.cancelled);
const baseEntry = (entity: Entity, base: Row | null): Entry | undefined => base ? { row: base, cancelled: base._cancelled === true } : undefined;
const keyOf = (entity: string, id: string) => `${entity}:${id}`;

// Registros em que o envio diverge do banco: candidatos a edição do usuário.
export function changedKeys(current: State, proposed: State): Key[] {
  const keys: Key[] = [];
  for (const entity of entities) {
    const now = rowsOf(current, entity), sent = rowsOf(proposed, entity);
    for (const [id, entry] of sent) if (!same(entity, entry, now.get(id))) keys.push({ entity, id });
    if (removable.has(entity)) for (const id of now.keys()) if (!sent.has(id)) keys.push({ entity, id });
  }
  return keys;
}

function setRows(state: State, entity: Entity, rows: Map<string, Entry>) {
  if (entity === 'appointments') {
    state.appointments = [...rows.values()].filter(e => !e.cancelled).map(e => e.row);
    state.cancelledAppointments = [...rows.values()].filter(e => e.cancelled).map(e => e.row);
  } else state[entity] = [...rows.values()].map(e => e.row);
}

// Cópias antigas (iguais à versão que o usuário leu) são substituídas pelo
// estado atual; assim só sobram no envio as alterações feitas pelo usuário.
export function rebase(current: State, proposed: State, bases: Base[]): State {
  const byKey = new Map(bases.map(b => [keyOf(b.entity, b.id), b]));
  const result: State = { ...proposed };
  for (const entity of entities) {
    const now = rowsOf(current, entity), sent = rowsOf(proposed, entity), out = new Map<string, Entry>();
    for (const [id, entry] of sent) {
      const base = byKey.get(keyOf(entity, id));
      if (base && same(entity, entry, baseEntry(entity, base.base)) && !same(entity, entry, now.get(id))) {
        const actual = now.get(id);
        if (actual) out.set(id, actual);
        continue;
      }
      out.set(id, entry);
    }
    for (const [id, entry] of now) {
      if (out.has(id) || sent.has(id)) continue;
      const base = byKey.get(keyOf(entity, id));
      // Linha criada depois da leitura do usuário, ou entidade que nunca é
      // removida por ausência: preservar.
      if (!removable.has(entity) || !base?.base) out.set(id, entry);
    }
    setRows(result, entity, out);
  }
  return result;
}

// 409 apenas quando o mesmo registro foi alterado pelo usuário e por outra pessoa.
export function conflictingKey(current: State, next: State, bases: Base[]): Key | null {
  const byKey = new Map(bases.map(b => [keyOf(b.entity, b.id), b]));
  for (const entity of entities) {
    const now = rowsOf(current, entity), after = rowsOf(next, entity);
    const touched = [...after].filter(([id, entry]) => now.has(id) && !same(entity, entry, now.get(id))).map(([id]) => id);
    if (removable.has(entity)) for (const id of now.keys()) if (!after.has(id)) touched.push(id);
    for (const id of touched) {
      const base = byKey.get(keyOf(entity, id));
      if (!base || base.baseVersion == null || base.baseVersion !== base.currentVersion) return { entity, id };
    }
  }
  return null;
}

const archiveOp: Record<string, string> = { hospitals: 'archive_hospital', scheduleBlocks: 'delete_block', schedulingRules: 'delete_rule' };
const upsertOp: Record<Entity, string> = { hospitals: 'upsert_hospital', patients: 'upsert_patient', appointments: 'upsert_appointment', scheduleBlocks: 'upsert_block', schedulingRules: 'upsert_rule' };
const ignoredLegacy = ['payment', 'invoiceNumber', 'received_amount', 'paid_at', 'payment_status', 'total_amount', 'net_amount'];
function payload(row: Row): Row { const copy = { ...row }; for (const key of ignoredLegacy) delete copy[key]; return copy; }

export function agendaOps(current: State, next: State, bases: Base[]): AgendaOp[] {
  const versions = new Map(bases.map(b => [keyOf(b.entity, b.id), b.currentVersion]));
  const version = (entity: Entity, id: string) => {
    const v = versions.get(keyOf(entity, id));
    if (v == null) throw new HttpError(409, 'A agenda mudou. Atualize e tente novamente.');
    return v;
  };
  const ops: AgendaOp[] = [];
  for (const entity of entities) {
    const now = rowsOf(current, entity), after = rowsOf(next, entity);
    for (const [id, entry] of after) {
      const old = now.get(id);
      if (same(entity, entry, old)) continue;
      ops.push({ op: upsertOp[entity], id, data: payload(entry.row), expectedVersion: old ? version(entity, id) : null, ...(entity === 'appointments' ? { cancelled: entry.cancelled } : {}) });
    }
    if (removable.has(entity)) for (const id of now.keys()) if (!after.has(id)) ops.push({ op: archiveOp[entity], id, expectedVersion: version(entity, id) });
    if (entity === 'appointments') {
      // Histórico vem depois de pacientes e consultas e é somente acréscimo.
      const known = new Set((current.patientHistory || []).map((h: Row) => String(h.id)));
      for (const h of next.patientHistory || []) if (!known.has(String(h.id))) ops.push({ op: 'append_history', id: String(h.id), data: h });
    }
  }
  if (next.settings && (text(next.settings.workStart) !== text(current.settings?.workStart) || text(next.settings.workEnd) !== text(current.settings?.workEnd)))
    ops.push({ op: 'save_settings', data: { workStart: next.settings.workStart, workEnd: next.settings.workEnd } });
  return ops;
}
