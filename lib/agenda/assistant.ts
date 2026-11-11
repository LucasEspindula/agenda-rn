// Assistente da agenda: resumo do dia e lembretes de cada pessoa.
// Função pura sobre a agenda já filtrada por papel (visibleState) e as sugestões pendentes
// que a pessoa pode ver. Sem dados financeiros nem CPF: só nomes, horários e o que fazer.
// A mesma função servirá ao e-mail da manhã quando o envio estiver configurado.
import { availabilityIntervals, intervalsOverlap, minutes } from "../agenda-availability";

// Legacy agenda rows are heterogeneous JSON objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export type SummaryRole = "general_manager" | "secretary" | "doctor";
export type SummaryItem = { appointmentId?: string; requestId?: string; professionalId?: string; date?: string; time?: string; title: string; detail: string };
export type ReminderKind = "unconfirmed" | "guide_expiring" | "guide_missing" | "conflict" | "stale_suggestion";
export type Reminder = { kind: ReminderKind; label: string; hint: string; count: number; items: SummaryItem[] };
export type AgendaSummary = {
  date: string; tomorrow: string; generatedAt: string;
  agenda: { today: number; tomorrow: number; professionals: Array<{ id: string; name: string; today: number; tomorrow: number }> };
  reminders: Reminder[];
  // Médico: a agenda de hoje (dele e das agendas a que tem acesso), sem pendências.
  todayList?: SummaryItem[];
};

export const MAX_ITEMS = 8;
const GUIDE_EXPIRING_DAYS = 5, GUIDE_MISSING_DAYS = 7, CONFLICT_DAYS = 14, STALE_HOURS = 24;

// Data local da clínica (o servidor roda em UTC).
export function localDate(now: Date, timeZone = "America/Sao_Paulo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
export function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
const brDate = (date: string) => date.split("-").reverse().join("/");
const active = (a: Row) => a.status !== "cancelled";
const byWhen = (a: Row, b: Row) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time));

export function buildAgendaSummary(input: {
  state: Row; role: SummaryRole; agendaIds: string[]; userId?: number; now: Date; requests?: Row[]; timeZone?: string;
}): AgendaSummary {
  const { state, role, agendaIds, now } = input;
  const today = localDate(now, input.timeZone), tomorrow = addDays(today, 1);
  const professionals = new Map<string, Row>((state.professionals || []).map((p: Row) => [String(p.id), p]));
  const patients = new Map<string, Row>((state.patients || []).map((p: Row) => [String(p.id), p]));
  const inScope = (id: unknown) => !!id && (role === "general_manager" ? professionals.has(String(id)) : agendaIds.includes(String(id)));
  const appointments = (state.appointments || []).filter((a: Row) => active(a) && (inScope(a.doctorId) || inScope(a.anesthetistId))).sort(byWhen);
  const patientName = (a: Row) => String(patients.get(String(a.patientId))?.name || "Paciente");
  const professionalName = (id: unknown) => String(professionals.get(String(id))?.name || "Profissional");
  const owner = (a: Row) => inScope(a.doctorId) ? String(a.doctorId) : String(a.anesthetistId);
  const item = (a: Row, detail: string): SummaryItem => ({
    appointmentId: String(a.id), professionalId: owner(a), date: a.date, time: a.time,
    title: `${patientName(a)} — ${brDate(a.date)} às ${a.time}`, detail: `${professionalName(owner(a))} · ${detail}`,
  });

  // Visão geral: hoje e amanhã, por agenda da pessoa.
  const counts = new Map<string, { today: number; tomorrow: number }>();
  for (const a of appointments) for (const id of [a.doctorId, a.anesthetistId]) {
    if (!inScope(id) || (a.date !== today && a.date !== tomorrow)) continue;
    const c = counts.get(String(id)) || { today: 0, tomorrow: 0 };
    if (a.date === today) c.today++; else c.tomorrow++;
    counts.set(String(id), c);
  }
  const agenda = {
    today: appointments.filter((a: Row) => a.date === today).length,
    tomorrow: appointments.filter((a: Row) => a.date === tomorrow).length,
    professionals: [...counts].map(([id, c]) => ({ id, name: professionalName(id), ...c })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
  };

  const reminders: Reminder[] = [];
  // O médico não recebe pendências: confirmar, guias, conflitos e sugestões são tarefa da secretaria
  // e da gerência. Ele vê a agenda do dia (e, por e-mail, a agenda da manhã e a prévia da semana).
  if (role === "doctor") return { date: today, tomorrow, generatedAt: now.toISOString(), agenda, reminders,
    todayList: appointments.filter((a: Row) => a.date === today).map((a: Row) => ({ ...item(a, String(a.procedure || "Atendimento")), title: `${a.time} · ${patientName(a)}` })) };
  const push = (kind: ReminderKind, label: string, hint: string, items: SummaryItem[]) => {
    if (items.length) reminders.push({ kind, label, hint, count: items.length, items: items.slice(0, MAX_ITEMS) });
  };

  // 1. Consultas de hoje e amanhã ainda sem confirmação.
  push("unconfirmed", "Aguardando confirmação", "Hoje e amanhã ainda em \"Agendado\": vale ligar para confirmar.",
    appointments.filter((a: Row) => (a.date === today || a.date === tomorrow) && a.status === "scheduled")
      .map((a: Row) => item(a, a.date === today ? "hoje" : "amanhã")));

  // 2. Guias: vencendo em até 5 dias e atendimentos de convênio da próxima semana sem validade.
  const upcoming = appointments.filter((a: Row) => a.date >= today && a.status !== "realized");
  push("guide_expiring", "Guias vencendo", `Validade da guia nos próximos ${GUIDE_EXPIRING_DAYS} dias.`,
    upcoming.filter((a: Row) => a.guideExpiry && a.guideExpiry >= today && a.guideExpiry <= addDays(today, GUIDE_EXPIRING_DAYS))
      .sort((a: Row, b: Row) => String(a.guideExpiry).localeCompare(String(b.guideExpiry)))
      .map((a: Row) => item(a, a.guideExpiry === today ? "guia vence hoje" : `guia vence em ${brDate(a.guideExpiry)}`)));
  push("guide_missing", "Guia sem validade", `Atendimentos de convênio nos próximos ${GUIDE_MISSING_DAYS} dias sem a validade da guia.`,
    upcoming.filter((a: Row) => !a.guideExpiry && a.date <= addDays(today, GUIDE_MISSING_DAYS) && a.forma_cobranca !== "PARTICULAR"
      && String(a.insurance ?? "").trim() && !/^particular$/i.test(String(a.insurance).trim()))
      .map((a: Row) => item(a, "informe a validade da guia")));

  // 3. Conflitos: dois atendimentos sobrepostos na mesma agenda ou atendimento dentro de um bloqueio.
  const conflictItems: SummaryItem[] = [], seen = new Set<string>();
  const horizon = addDays(today, CONFLICT_DAYS);
  const soon = appointments.filter((a: Row) => a.date >= today && a.date <= horizon);
  const ids = role === "general_manager" ? [...professionals.keys()] : agendaIds;
  for (const id of ids) {
    const mine = soon.filter((a: Row) => a.doctorId === id || a.anesthetistId === id);
    for (let i = 0; i < mine.length; i++) {
      const a = mine[i], start = minutes(a.time), end = start + Number(a.duration || 0);
      for (let j = i + 1; j < mine.length; j++) {
        const b = mine[j];
        if (b.date !== a.date) continue;
        const bs = minutes(b.time), be = bs + Number(b.duration || 0);
        const key = [a.id, b.id].sort().join("|");
        if (!seen.has(key) && intervalsOverlap(start, end, bs, be)) {
          seen.add(key);
          conflictItems.push({ ...item(a, `sobrepõe ${patientName(b)} às ${b.time}`), professionalId: id, detail: `${professionalName(id)} · sobrepõe ${patientName(b)} às ${b.time}` });
        }
      }
      for (const block of availabilityIntervals(state, id, a.date, false)) {
        const key = a.id + "|" + block.id;
        if (block.kind === "manual" && !seen.has(key) && intervalsOverlap(start, end, block.start, block.end)) {
          seen.add(key);
          conflictItems.push({ ...item(a, "dentro de um bloqueio"), professionalId: id, detail: `${professionalName(id)} · dentro do bloqueio "${block.reason}"` });
        }
      }
    }
  }
  push("conflict", "Conflitos de horário", `Sobreposições nos próximos ${CONFLICT_DAYS} dias.`, conflictItems.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time).localeCompare(String(b.time))));

  // 4. Sugestões de médicos paradas há mais de 24 h, nas agendas de quem decide.
  const cutoff = now.getTime() - STALE_HOURS * 3600_000;
  const stale = (input.requests || []).filter((r: Row) => r.status === "pending" && Date.parse(r.created_at) < cutoff
    && (role === "general_manager" || agendaIds.includes(String(r.professional_id))))
    .sort((a: Row, b: Row) => String(a.created_at).localeCompare(String(b.created_at)))
    .map((r: Row): SummaryItem => {
      const p = (r.proposed_payload || r.previous_payload || {}) as Row;
      const hours = Math.floor((now.getTime() - Date.parse(r.created_at)) / 3600_000);
      const waiting = hours >= 48 ? `${Math.floor(hours / 24)} dias` : `${hours} h`;
      const action = r.action === "delete" ? "desagendar" : r.action === "update" ? "alterar" : "agendar";
      return { requestId: String(r.id), professionalId: String(r.professional_id), date: p.date, time: p.time,
        title: `${action[0].toUpperCase() + action.slice(1)} ${patientName(p)}${p.date ? ` — ${brDate(p.date)} às ${p.time}` : ""}`,
        detail: `${professionalName(r.professional_id)} · aguardando há ${waiting}` };
    });
  push("stale_suggestion", "Sugestões aguardando decisão", "Sugestões de médicos paradas há mais de 24 h.", stale);

  return { date: today, tomorrow, generatedAt: now.toISOString(), agenda, reminders };
}
