import {validCPF,normalizeCPF} from '../cpf';
import { HttpError } from './http';
// Legacy agenda payload is heterogeneous; validateStateChange validates writes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type State = Record<string, any>;
export type Principal = { account: { role: string }; agendaIds: string[] };
const collections = ['patients','professionals','hospitals','appointments','cancelledAppointments','patientHistory','schedulingRules','scheduleBlocks'];
const ids = /^[A-Za-z0-9_-]{1,128}$/;
const date = /^\d{4}-\d{2}-\d{2}$/;
const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function validId(id: unknown): id is string { return typeof id === 'string' && ids.test(id); }
export function canReadAppointment(p: Principal, a: Row) { return p.account.role === 'general_manager' || [a.doctorId,a.anesthetistId].some(id => id && p.agendaIds.includes(id)); }
function ownedPatient(p: Principal, a: Row) { return p.account.role === 'general_manager' || p.agendaIds.includes(a.doctorId); }
function walk(value: unknown, depth = 0) {
  if (depth > 12) throw new HttpError(400, 'Estrutura muito profunda.');
  if (typeof value === 'string' && value.length > 20000) throw new HttpError(400, 'Texto muito longo.');
  if (typeof value === 'number' && !Number.isFinite(value)) throw new HttpError(400, 'Número inválido.');
  if (value && typeof value === 'object') for (const [key, v] of Object.entries(value)) {
    if (['__proto__','constructor','prototype','is_admin','isAdmin'].includes(key)) throw new HttpError(400, 'Campo não permitido.');
    walk(v, depth + 1);
  }
}
export function validateAppointment(a: Row) {
  if (!a || Array.isArray(a) || typeof a !== "object") throw new HttpError(400, "Agendamento inválido.");
  walk(a);
  if (a.forma_cobranca != null && !['PARTICULAR','CONVENIO'].includes(a.forma_cobranca)) throw new HttpError(400, 'Forma de cobrança inválida.');
  if (!validId(a.id) || !date.test(a.date) || !time.test(a.time) || !Number.isInteger(a.duration) || a.duration < 1 || a.duration > 1440 ||
      !['scheduled','confirmed','authorized','analysis','realized'].includes(a.status) || (!a.doctorId && !a.anesthetistId)) throw new HttpError(400, 'Agendamento inválido.');
  for (const key of ['doctorId','anesthetistId','patientId','hospitalId']) if (a[key] && !validId(a[key])) throw new HttpError(400, 'Vínculo inválido.');
}
export function validateState(s: State) {
  walk(s);
  if (Object.keys(s).some(k => ![...collections,'settings','schemaVersion'].includes(k))) throw new HttpError(400, 'Campo de agenda não permitido.');
  for (const key of collections) {
    if (!Array.isArray(s[key]) || s[key].length > 50000) throw new HttpError(400, 'Coleção inválida.');
    const seen = new Set();
    for (const row of s[key]) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || !validId(row.id) || seen.has(row.id)) throw new HttpError(400, 'Identificador inválido ou duplicado.');
      seen.add(row.id);
      if(key==='patients'&&row.cpf){if(typeof row.cpf!=='string'||!validCPF(row.cpf))throw new HttpError(400,'CPF inválido. Deixe vazio se não informado.');row.cpf=normalizeCPF(row.cpf);}
      if(key==='patients'&&row.address!=null&&typeof row.address!=='string')throw new HttpError(400,'Endereço inválido.');
      for (const field of ['name','email','phone','insurance','cardNumber','crm','specialty','category','notes','procedure','invoiceNumber','reason','text','type','at','severity','start','end','date','time','cancelReason','suggestionReason','rescheduleReason','abbreviation']) if (row[field] !== undefined && row[field] !== null && typeof row[field] !== 'string') throw new HttpError(400, 'Texto inválido.');
      if(key==='hospitals'&&row.abbreviation!=null&&String(row.abbreviation).length>16)throw new HttpError(400,'Abreviação inválida.');
      for (const field of ['doctorId','anesthetistId','patientId','professionalId','hospitalId','appointmentId']) if (row[field] && !validId(row[field])) throw new HttpError(400, 'Vínculo inválido.');
    }
  }
  for (const a of [...s.appointments,...s.cancelledAppointments]) validateAppointment(a);
  const active = new Set(s.appointments.map((a: Row) => a.id));
  if (s.cancelledAppointments.some((a: Row) => active.has(a.id))) throw new HttpError(400, 'Agendamento duplicado no arquivo.');
  if (!s.settings || !time.test(s.settings.workStart) || !time.test(s.settings.workEnd) || s.settings.workStart >= s.settings.workEnd) throw new HttpError(400, 'Horário de trabalho inválido.');
}
// Financial reads for doctors come exclusively from the scoped financial APIs.
export function withoutLegacyFinance<T>(value:T):T {
  if(Array.isArray(value))return value.map(withoutLegacyFinance) as T;
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['payment','invoiceNumber','received_amount','paid_at','payment_status','total_amount','net_amount'].includes(key)).map(([key,item])=>[key,withoutLegacyFinance(item)])) as T;
  return value;
}
export function visibleState(s: State, p: Principal): State {
  if (p.account.role === 'general_manager') return s;
  const appointments = (s.appointments || []).filter((a: Row) => canReadAppointment(p,a));
  const cancelled = (s.cancelledAppointments || []).filter((a: Row) => canReadAppointment(p,a));
  // O anestesista também participa do agendamento, ainda que o cadastro único
  // do paciente tenha sido associado originalmente à agenda do cirurgião.
  // Visibilidade clínica não concede permissão de alterar o cadastro alheio.
  const accessiblePatientIds = new Set([...appointments,...cancelled].map((a: Row) => a.patientId).filter(Boolean));
  const patients = (s.patients || []).filter((a: Row) =>
    ownedPatient(p,a) || accessiblePatientIds.has(a.id));
  const patientIds = new Set(patients.map((a: Row) => a.id));
  const appointmentIds = new Set([...appointments,...cancelled].map((a: Row) => a.id));
  return { schemaVersion:s.schemaVersion, settings:s.settings, professionals:s.professionals || [], hospitals:s.hospitals || [],
    patients:p.account.role==='doctor'?patients.map((patient:Row)=>{const clinical={...patient};delete clinical.cpf;delete clinical.address;return clinical}):patients, appointments:p.account.role==='doctor'?withoutLegacyFinance(appointments):appointments, cancelledAppointments:p.account.role==='doctor'?withoutLegacyFinance(cancelled):cancelled,
    patientHistory:(s.patientHistory || []).filter((h: Row) => patientIds.has(h.patientId) && (!h.appointmentId || appointmentIds.has(h.appointmentId)) && (p.account.role!=='doctor'||!String(h.type||'').toLowerCase().includes('financeiro'))),
    schedulingRules:(s.schedulingRules || []).filter((a: Row) => p.agendaIds.includes(a.professionalId)),
    scheduleBlocks:(s.scheduleBlocks || []).filter((a: Row) => p.agendaIds.includes(a.professionalId)) };
}
function mergeOwned(current: Row[], proposed: Row[], editable: (row: Row) => boolean, originals = current): Row[] {
  const original = new Map(originals.map(row => [row.id,row]));
  const retained = current.filter(row => !editable(row));
  const accepted = [];
  for (const row of proposed) {
    const old = original.get(row.id);
    if (old && !editable(old)) {
      if (JSON.stringify(old) !== JSON.stringify(row)) throw new HttpError(403, 'Registro de outra agenda.');
      continue;
    }
    if (!editable(row)) throw new HttpError(403, 'Agenda sem permissão.');
    // Shared appointments must not gain a new unauthorized professional by changing ownership.
    for (const key of ['doctorId','anesthetistId']) if (old && old[key] !== row[key]) throw new HttpError(403, 'Transferência de agenda exige a gerência.');
    accepted.push(row);
  }
  return [...retained,...accepted];
}
export function mergeState(current: State | null, proposed: State, p: Principal): State {
  validateState(proposed);
  if (p.account.role === 'general_manager') return current ? {...proposed,professionals:current.professionals} : proposed;
  if (!current) throw new HttpError(403, 'Somente a gerência inicializa a agenda.');
  if (p.account.role === 'doctor') {
    const scheduleBlocks = mergeOwned(current.scheduleBlocks || [], proposed.scheduleBlocks, b => p.agendaIds.includes(b.professionalId));
    for (const b of proposed.scheduleBlocks) if (!date.test(b.date) || !time.test(b.start) || !time.test(b.end) || b.start >= b.end || typeof b.reason !== 'string' || !b.reason.trim()) throw new HttpError(400, 'Bloqueio inválido.');
    return { ...current, scheduleBlocks };
  }
  if (p.account.role !== 'secretary') throw new HttpError(403, 'Papel inválido.');
  const all = [...(current.appointments || []),...(current.cancelledAppointments || [])];
  const appointments = mergeOwned(current.appointments || [],proposed.appointments,a=>canReadAppointment(p,a),all);
  const cancelledAppointments = mergeOwned(current.cancelledAppointments || [],proposed.cancelledAppointments,a=>canReadAppointment(p,a),all);
  const patients = mergeOwned(current.patients || [],proposed.patients,a=>ownedPatient(p,a));
  const ownedIds = new Set(patients.filter(a=>ownedPatient(p,a)).map(a=>a.id));
  const originalAppointments = new Map(all.map((a: Row)=>[a.id,a]));
  for (const a of [...proposed.appointments,...proposed.cancelledAppointments]) {
    const old = originalAppointments.get(a.id) as Row | undefined;
    if (a.patientId && !ownedIds.has(a.patientId) && old?.patientId !== a.patientId) throw new HttpError(403, 'Paciente de outra agenda.');
    if (!old) for (const key of ['doctorId','anesthetistId']) if (a[key] && !p.agendaIds.includes(a[key])) throw new HttpError(403, 'Novo vínculo exige acesso às agendas envolvidas.');
  }
  const historyIds = new Set((current.patientHistory || []).map((h: Row)=>h.id));
  const newHistory = proposed.patientHistory.filter((h: Row)=>!historyIds.has(h.id));
  for (const h of newHistory) if (!ownedIds.has(h.patientId) || (h.appointmentId && ![...appointments,...cancelledAppointments].some(a=>a.id===h.appointmentId && a.patientId===h.patientId && canReadAppointment(p,a)))) throw new HttpError(403, 'Histórico sem permissão.');
  // Existing clinical history is append-only for secretaries, never overwritten by a client snapshot.
  return {...current,patients,appointments,cancelledAppointments,patientHistory:[...(current.patientHistory || []),...newHistory]};
}
