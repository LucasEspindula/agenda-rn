// Agenda para impressão: o mesmo modelo serve ao botão de impressão e ao PDF do e-mail
// (agenda de amanhã às 20h e prévia da semana). Função pura sobre a agenda já filtrada
// por papel (visibleState). Sem CPF, contatos, observações nem valores financeiros.
import { agendaTimeline, appointmentInsurance, appointmentStatusLabel } from "../agenda-report";
import { isAnesthesiologist } from "../medical-specialties";

// Legacy agenda rows are heterogeneous JSON objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export type PrintMode = "day" | "week" | "month";
export type PrintStatus = "scheduled" | "confirmed" | "authorized" | "analysis" | "realized" | "other";
export type PrintEntry =
  | { kind: "appointment"; id: string; start: string; end: string; patient: string; procedure: string;
      partner: string; hospital: string; insurance: string; careType: string; flags: string[]; status: PrintStatus; statusLabel: string }
  | { kind: "block"; start: string; end: string; reason: string };
export type PrintDay = { date: string; label: string; appointments: number; entries: PrintEntry[] };
export type PrintAgenda = {
  professional: { id: string; name: string; crm: string; role: "Cirurgião" | "Anestesista" };
  appointments: number; blocks: number; days: PrintDay[];
};
export type AgendaPrint = {
  organization: string; mode: PrintMode; title: string; periodLabel: string; start: string; end: string;
  generatedAt: string; generatedBy: string; agendas: PrintAgenda[];
};

export const PRINT_MODES: readonly PrintMode[] = ["day", "week", "month"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const parts = (date: string) => date.split("-").map(Number) as [number, number, number];
const utc = (date: string) => new Date(date + "T12:00:00Z");
export function addDays(date: string, days: number): string {
  const d = utc(date); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function weekday(date: string): string { return WEEKDAYS[utc(date).getUTCDay()]; }

// Semana de domingo a sábado, como na tela da agenda.
export function agendaPeriod(mode: PrintMode, date: string): { start: string; end: string } {
  if (mode === "week") { const start = addDays(date, -utc(date).getUTCDay()); return { start, end: addDays(start, 6) }; }
  if (mode === "month") {
    const [y, m] = parts(date);
    return { start: `${date.slice(0, 7)}-01`, end: new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10) };
  }
  return { start: date, end: date };
}

// "Quinta-feira, 12 de novembro de 2026" · "8 a 14 de novembro de 2026" · "Novembro de 2026"
export function periodLabel(mode: PrintMode, start: string, end: string): string {
  const [y1, m1, d1] = parts(start), [y2, m2, d2] = parts(end);
  if (mode === "month") return MONTHS[m1 - 1][0].toUpperCase() + MONTHS[m1 - 1].slice(1) + ` de ${y1}`;
  if (mode === "day") return `${weekday(start)}, ${d1} de ${MONTHS[m1 - 1]} de ${y1}`;
  if (y1 !== y2) return `${d1} de ${MONTHS[m1 - 1]} de ${y1} a ${d2} de ${MONTHS[m2 - 1]} de ${y2}`;
  if (m1 !== m2) return `${d1} de ${MONTHS[m1 - 1]} a ${d2} de ${MONTHS[m2 - 1]} de ${y2}`;
  return `${d1} a ${d2} de ${MONTHS[m2 - 1]} de ${y2}`;
}
const dayLabel = (date: string) => { const [, m, d] = parts(date); return `${weekday(date)}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`; };
const endTime = (time: string, duration: unknown) => {
  const [h, m] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return "";
  const total = h * 60 + m + Math.max(0, Number(duration) || 0);
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};
const STATUS: Record<string, PrintStatus> = {
  scheduled: "scheduled", rescheduled: "scheduled", provisional: "scheduled", confirmed: "confirmed",
  authorized: "authorized", analysis: "analysis", realized: "realized", attended: "realized",
};
const CARE: Record<string, string> = { outpatient: "Ambulatorial", inpatient: "Internado" };
const shortDoctor = (name: string) => name.replace(/^(dr\.?|dra\.?)\s+/i, (t) => t.trim().replace(/\.?$/, ".") + " ");

export function buildAgendaPrint(input: {
  state: Row; professionalIds: string[]; mode: PrintMode; date: string;
  organization: string; generatedBy: string; now: Date;
}): AgendaPrint {
  const { state, mode } = input, { start, end } = agendaPeriod(mode, input.date);
  const byId = <T extends Row>(rows: T[] | undefined) => new Map((rows || []).map((r) => [String(r.id), r] as const));
  const professionals = byId(state.professionals), patients = byId(state.patients), hospitals = byId(state.hospitals);
  const agendas: PrintAgenda[] = [];
  for (const id of input.professionalIds) {
    const professional = professionals.get(id);
    if (!professional) continue;
    const anesthetist = isAnesthesiologist(professional);
    const appointments = (state.appointments || []).filter((a: Row) => a.status !== "cancelled" && a.date >= start && a.date <= end
      && (anesthetist ? a.anesthetistId === id : a.doctorId === id));
    const blocks = (state.scheduleBlocks || []).filter((b: Row) => b.professionalId === id && b.date >= start && b.date <= end);
    const byDate = new Map<string, PrintEntry[]>();
    for (const entry of agendaTimeline(appointments as Array<Row & { date: string }>, blocks as Array<Row & { date: string; start: string }>)) {
      const list = byDate.get(entry.date) || [];
      if (entry.kind === "block") list.push({ kind: "block", start: entry.block.start, end: entry.block.end, reason: String(entry.block.reason || "Indisponível") });
      else {
        const a = entry.appointment, partner = professionals.get(String(anesthetist ? a.doctorId : a.anesthetistId));
        list.push({
          kind: "appointment", id: String(a.id), start: String(a.time || ""), end: endTime(a.time, a.duration),
          patient: String(patients.get(String(a.patientId))?.name || "Paciente não informado"),
          procedure: String(a.procedure || "Procedimento não informado"),
          partner: partner ? `${anesthetist ? "Cirurgião" : "Anestesista"}: ${shortDoctor(String(partner.name))}` : "",
          hospital: String(hospitals.get(String(a.hospitalId))?.name || ""),
          insurance: appointmentInsurance(a as { insurance?: string | null }, patients.get(String(a.patientId))) || "",
          careType: CARE[String(a.careType)] || "",
          flags: [a.opme && "OPME", a.exams && "Exames", a.reports && "Laudos"].filter(Boolean) as string[],
          status: STATUS[String(a.status)] || "other", statusLabel: appointmentStatusLabel(a.status),
        });
      }
      byDate.set(entry.date, list);
    }
    // Dia e semana mostram todos os dias (inclusive os livres); o mês, só os dias com agenda.
    const dates: string[] = [];
    if (mode === "month") dates.push(...[...byDate.keys()].sort());
    else for (let d = start; d <= end; d = addDays(d, 1)) dates.push(d);
    agendas.push({
      professional: { id, name: String(professional.name || "Profissional"), crm: String(professional.crm || ""), role: anesthetist ? "Anestesista" : "Cirurgião" },
      appointments: appointments.length, blocks: blocks.length,
      days: dates.map((date) => {
        const entries = byDate.get(date) || [];
        return { date, label: dayLabel(date), appointments: entries.filter((e) => e.kind === "appointment").length, entries };
      }),
    });
  }
  return {
    organization: input.organization, mode,
    title: mode === "week" ? "Agenda da semana" : mode === "month" ? "Agenda do mês" : "Agenda do dia",
    periodLabel: periodLabel(mode, start, end), start, end,
    generatedAt: input.now.toISOString(), generatedBy: input.generatedBy, agendas,
  };
}
