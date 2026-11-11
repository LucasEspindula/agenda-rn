// Hub: resumo de cada agenda que a pessoa logada pode ver (antes era o card "Resumo do dia" no topo
// da agenda). Função pura sobre a agenda já filtrada por papel (visibleState) e as sugestões
// pendentes que a pessoa pode ver. Sem CPF, telefone nem dados do faturamento.
import { buildAgendaSummary, localDate, addDays, type Reminder, type ReminderKind, type SummaryRole } from "./assistant";
import { isAnesthesiologist } from "../medical-specialties";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export type HubAppointment = {
  id: string; date: string; time: string; end: string; patient: string; procedure: string;
  status: string; statusLabel: string; partner: string | null;
};
export type HubAgenda = {
  id: string; name: string; role: "Cirurgião" | "Anestesista"; specialty: string;
  today: number; tomorrow: number; week: number;
  next: HubAppointment | null;
  todayList: HubAppointment[];
  pending: Array<{ kind: ReminderKind; label: string; count: number }>;
  pendingTotal: number;
};
export type Hub = {
  date: string; tomorrow: string; time: string; generatedAt: string; doctor: boolean;
  totals: { today: number; tomorrow: number; pending: number; agendas: number };
  reminders: Reminder[];
  agendas: HubAgenda[];
};

const STATUS: Record<string, string> = {
  scheduled: "Agendado", confirmed: "Confirmado", authorized: "Autorizado", analysis: "Em análise", realized: "Realizado",
};
const hhmm = (value: number) => `${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const toMinutes = (time: unknown) => { const [h, m] = String(time || "00:00").split(":").map(Number); return (h || 0) * 60 + (m || 0); };

export function localTime(now: Date, timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

export function buildHub(input: {
  state: Row; role: SummaryRole; agendaIds: string[]; doctorId?: string | null; userId?: number; now: Date;
  requests?: Row[]; timeZone?: string;
}): Hub {
  const { state, role, now } = input;
  const today = localDate(now, input.timeZone), tomorrow = addDays(today, 1), weekEnd = addDays(today, 6);
  const time = localTime(now, input.timeZone), doctor = role === "doctor";
  const professionals: Row[] = state.professionals || [];
  const byId = new Map<string, Row>(professionals.map((p) => [String(p.id), p]));
  const patients = new Map<string, Row>((state.patients || []).map((p: Row) => [String(p.id), p]));
  // Gerência vê todas as agendas da organização; os demais, as agendas liberadas (o médico, a própria inclusive).
  const allowed = role === "general_manager" ? professionals.map((p) => String(p.id))
    : [...new Set([...(input.agendaIds || []), ...(doctor && input.doctorId ? [input.doctorId] : [])].map(String))];
  const ids = allowed.filter((id) => byId.has(id))
    .sort((a, b) => String(byId.get(a)?.name).localeCompare(String(byId.get(b)?.name), "pt-BR"));
  const active = (state.appointments || []).filter((a: Row) => a.status !== "cancelled");

  const view = (a: Row, ownerId: string): HubAppointment => {
    const start = toMinutes(a.time), other = String(a.doctorId) === ownerId ? a.anesthetistId : a.doctorId;
    const otherName = other ? byId.get(String(other))?.name : null;
    return {
      id: String(a.id), date: String(a.date), time: String(a.time), end: hhmm(start + Number(a.duration || 0)),
      patient: String(patients.get(String(a.patientId))?.name || "Paciente"),
      procedure: String(a.procedure || "Procedimento não informado"),
      status: String(a.status || "scheduled"), statusLabel: STATUS[String(a.status)] || "Agendado",
      partner: otherName ? `${String(a.doctorId) === ownerId ? "Anestesista" : "Cirurgião"}: ${otherName}` : null,
    };
  };

  const agendas = ids.map((id): HubAgenda => {
    const p = byId.get(id) as Row;
    const mine = active.filter((a: Row) => String(a.doctorId) === id || String(a.anesthetistId) === id)
      .sort((a: Row, b: Row) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time)));
    const todays = mine.filter((a: Row) => a.date === today);
    const nextRow = mine.find((a: Row) => a.date > today || (a.date === today && toMinutes(a.time) + Number(a.duration || 0) > toMinutes(time)));
    // Pendências da agenda: as mesmas regras do assistente, restritas a esta agenda (médico não tem).
    const reminders = doctor ? [] : buildAgendaSummary({
      state, role: "secretary", agendaIds: [id], userId: input.userId, now, requests: input.requests, timeZone: input.timeZone,
    }).reminders;
    const pending = reminders.map((r) => ({ kind: r.kind, label: r.label, count: r.count }));
    return {
      id, name: String(p.name || "Profissional"), role: isAnesthesiologist(p) ? "Anestesista" : "Cirurgião",
      specialty: String(p.specialty || ""),
      today: todays.length, tomorrow: mine.filter((a: Row) => a.date === tomorrow).length,
      week: mine.filter((a: Row) => a.date >= today && a.date <= weekEnd).length,
      next: nextRow ? view(nextRow, id) : null,
      todayList: todays.map((a: Row) => view(a, id)),
      pending, pendingTotal: pending.reduce((sum, r) => sum + r.count, 0),
    };
  });

  // Visão geral: lembretes de todas as agendas juntos (sem repetir o atendimento de cirurgião e anestesista).
  const overall = buildAgendaSummary({
    state, role, agendaIds: ids, userId: input.userId, now, requests: input.requests, timeZone: input.timeZone,
  });
  const reminders = doctor ? [] : overall.reminders;
  return {
    date: today, tomorrow, time, generatedAt: now.toISOString(), doctor,
    totals: {
      today: overall.agenda.today, tomorrow: overall.agenda.tomorrow,
      pending: reminders.reduce((sum, r) => sum + r.count, 0), agendas: agendas.length,
    },
    reminders, agendas,
  };
}
