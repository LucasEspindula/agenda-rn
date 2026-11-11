import { getSession } from "@/app/authz";
import { canUseAgenda, doctorHome } from "@/lib/doctor-services";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, CalendarCheck, CalendarClock, CalendarDays, CheckCircle2, ClipboardList, FileClock, FileWarning, Printer, Clock3, Users, MessageSquareMore } from "lucide-react";
import SiteHeader from "@/components/site-header";
import { loadAgendaWindow } from "@/lib/agenda/store";
import { visibleState } from "@/lib/security/state";
import { localDate } from "@/lib/agenda/assistant";
import { buildHub, type HubAgenda, type HubAppointment } from "@/lib/agenda/hub";
import { loadPendingRequests } from "@/lib/agenda/pending-requests";
import type { ReminderKind, SummaryItem } from "@/lib/agenda/assistant";
import HubRefresh from "./hub-refresh";

export const dynamic = "force-dynamic";

const KIND_ICON: Record<ReminderKind, typeof AlertTriangle> = {
  unconfirmed: CalendarClock, guide_expiring: FileClock, guide_missing: FileWarning, conflict: AlertTriangle, stale_suggestion: MessageSquareMore,
};
const SHOWN_TODAY = 6;

// Links para a agenda: abre na agenda certa, no dia certo e, se houver, no agendamento.
function agendaHref(professional: string, date?: string, appointment?: string) {
  const q = new URLSearchParams({ agenda: "1", professional });
  if (date) q.set("date", date);
  if (appointment) q.set("appointment", appointment);
  return "/dashboard?" + q.toString();
}
function itemHref(item: SummaryItem) {
  if (item.requestId) return "/dashboard?agenda=1&view=requests";
  return agendaHref(item.professionalId || "", item.date, item.appointmentId);
}
function longDate(date: string) {
  const text = new Date(date + "T12:00:00Z").toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return text[0].toUpperCase() + text.slice(1);
}
function greeting(time: string) {
  const hour = Number(time.slice(0, 2));
  return hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const initials = (name: string) => name.replace(/^(Dra?\.?)\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

function Appointment({ a, agenda, now, today }: { a: HubAppointment; agenda: string; now: string; today: string }) {
  const current = a.date === today && a.time <= now && a.end > now;
  return <li><a className={`hub-appt status-${a.status}${current ? " current" : ""}`} href={agendaHref(agenda, a.date, a.id)}>
    <span className="hub-appt-time"><strong>{a.time}</strong><small>{a.end}</small></span>
    <span className="hub-appt-body"><strong>{a.patient}</strong><small>{a.procedure}{a.partner ? ` · ${a.partner}` : ""}</small></span>
    <span className="hub-pill">{current ? "Agora" : a.statusLabel}</span>
  </a></li>;
}

function AgendaCard({ agenda, today, now }: { agenda: HubAgenda; today: string; now: string }) {
  const rest = agenda.todayList.length - SHOWN_TODAY;
  return <article className={`hub-card${agenda.pendingTotal ? " has-pending" : ""}`} aria-labelledby={`agenda-${agenda.id}`}>
    <header className="hub-card-head">
      <span className={`hub-card-avatar ${agenda.role === "Anestesista" ? "anest" : ""}`} aria-hidden="true">{initials(agenda.name)}</span>
      <div><h3 id={`agenda-${agenda.id}`}>{agenda.name}</h3><p>{agenda.role === "Anestesista" ? "Anestesista" : agenda.specialty || "Médico"}</p></div>
      {agenda.pendingTotal > 0 && <span className="hub-card-alert" title="Pendências desta agenda">{agenda.pendingTotal}</span>}
    </header>
    <dl className="hub-card-counts">
      <div><dt>Hoje</dt><dd>{agenda.today}</dd></div>
      <div><dt>Amanhã</dt><dd>{agenda.tomorrow}</dd></div>
      <div><dt>7 dias</dt><dd>{agenda.week}</dd></div>
    </dl>
    {agenda.next ? <a className="hub-next" href={agendaHref(agenda.id, agenda.next.date, agenda.next.id)}>
      <Clock3 size={16} aria-hidden="true"/>
      <span><small>{agenda.next.date === today ? (agenda.next.time <= now ? "Em andamento" : "Próximo") : `Próximo · ${agenda.next.date.split("-").reverse().slice(0, 2).join("/")}`}</small>
        <strong>{agenda.next.time} · {agenda.next.patient}</strong></span>
    </a> : <p className="hub-next empty"><CalendarCheck size={16} aria-hidden="true"/>Nada agendado pela frente.</p>}
    {agenda.pending.length > 0 && <ul className="hub-chips" aria-label="Pendências">
      {agenda.pending.map((p) => { const Icon = KIND_ICON[p.kind]; return <li key={p.kind} className={`hub-chip ${p.kind}`}><Icon size={13} aria-hidden="true"/>{p.label}<b>{p.count}</b></li>; })}
    </ul>}
    <section className="hub-today" aria-label={`Hoje na agenda de ${agenda.name}`}>
      <h4>Hoje</h4>
      {agenda.todayList.length ? <ol>{agenda.todayList.slice(0, SHOWN_TODAY).map((a) => <Appointment key={a.id} a={a} agenda={agenda.id} now={now} today={today}/>)}</ol>
        : <p className="hub-empty-line">Sem atendimentos hoje.</p>}
      {rest > 0 && <a className="hub-more" href={agendaHref(agenda.id, today)}>Mais {plural(rest, "atendimento", "atendimentos")}</a>}
    </section>
    <footer className="hub-card-foot">
      <a className="hub-btn primary" href={agendaHref(agenda.id, today)}>Abrir agenda<ArrowRight size={15} aria-hidden="true"/></a>
      <a className="hub-btn" href={`/api/reports/agenda?period=day&date=${today}&professional_id=${encodeURIComponent(agenda.id)}`} target="_blank" rel="noopener" title="Agenda de hoje em PDF"><Printer size={15} aria-hidden="true"/>Imprimir hoje</a>
    </footer>
  </article>;
}

// Hub: o resumo de todas as agendas que a pessoa pode ver. Ajuda a secretária com várias agendas;
// o médico vê só a agenda do dia, sem pendências.
export default async function HubPage({ searchParams }: { searchParams: Promise<{ filtro?: string }> }) {
  const session = await getSession();
  if (!session?.account) redirect("/");
  if (!canUseAgenda(session)) redirect(doctorHome(session));
  const params = await searchParams;
  const now = new Date(), today = localDate(now);
  const { state } = await loadAgendaWindow(session.account.id, today, session.organization.id);
  const hub = buildHub({
    state: visibleState(state, session), role: session.account.role, agendaIds: session.agendaIds,
    doctorId: session.account.doctorId, userId: session.account.id, now, requests: await loadPendingRequests(session),
  });
  const onlyPending = !hub.doctor && params.filtro === "pendencias";
  const agendas = onlyPending ? hub.agendas.filter((a) => a.pendingTotal > 0) : hub.agendas;
  const firstName = session.account.name.replace(/^(Dra?\.?)\s+/i, "").split(/\s+/)[0];

  return <div className="rn-hub"><SiteHeader account={session.account} services={session.services} active="hub"/>
    <main className="hub-content hub-home">
      <HubRefresh/>
      <section className="hub-hero">
        <div>
          <p className="hub-eyebrow">{longDate(hub.date)}</p>
          <h1>{greeting(hub.time)}, {firstName}</h1>
          <p className="hub-lead">{hub.doctor ? "Sua agenda de hoje e das agendas a que você tem acesso." : agendas.length > 1 || hub.totals.agendas > 1 ? "O resumo de todas as suas agendas em um só lugar." : "O resumo da sua agenda."} <span className="hub-updated">Atualizado às {hub.time}.</span></p>
        </div>
        <a className="hub-btn primary" href="/dashboard?agenda=1"><CalendarDays size={16} aria-hidden="true"/>Ir para a agenda</a>
      </section>

      <section className="hub-stats" aria-label="Visão geral">
        <div className="hub-stat"><CalendarDays size={20} aria-hidden="true"/><span><strong>{hub.totals.today}</strong>{hub.totals.today === 1 ? "atendimento hoje" : "atendimentos hoje"}</span></div>
        <div className="hub-stat"><CalendarClock size={20} aria-hidden="true"/><span><strong>{hub.totals.tomorrow}</strong>amanhã</span></div>
        {!hub.doctor && <div className={`hub-stat ${hub.totals.pending ? "warn" : "ok"}`}>{hub.totals.pending ? <ClipboardList size={20} aria-hidden="true"/> : <CheckCircle2 size={20} aria-hidden="true"/>}<span><strong>{hub.totals.pending}</strong>{hub.totals.pending === 1 ? "pendência" : "pendências"}</span></div>}
        <div className="hub-stat"><Users size={20} aria-hidden="true"/><span><strong>{hub.totals.agendas}</strong>{hub.totals.agendas === 1 ? "agenda" : "agendas"}</span></div>
      </section>

      <div className={`hub-layout${hub.doctor ? " single" : ""}`}>
        <section className="hub-agendas" aria-labelledby="hub-agendas-title">
          <div className="hub-section-head">
            <h2 id="hub-agendas-title">Agendas</h2>
            {!hub.doctor && hub.agendas.length > 1 && <nav className="hub-filter" aria-label="Filtrar agendas">
              <a href="/hub" aria-current={!onlyPending ? "page" : undefined}>Todas <b>{hub.agendas.length}</b></a>
              <a href="/hub?filtro=pendencias" aria-current={onlyPending ? "page" : undefined}>Com pendências <b>{hub.agendas.filter((a) => a.pendingTotal > 0).length}</b></a>
            </nav>}
          </div>
          {agendas.length ? <div className="hub-grid">{agendas.map((a) => <AgendaCard key={a.id} agenda={a} today={hub.date} now={hub.time}/>)}</div>
            : <p className="hub-blank">{onlyPending ? "Nenhuma agenda com pendências. Tudo em dia!" : "Nenhuma agenda liberada para você ainda. Fale com a gerência da clínica."}</p>}
        </section>

        {!hub.doctor && <aside className="hub-tasks" aria-labelledby="hub-tasks-title">
          <div className="hub-section-head"><h2 id="hub-tasks-title">Pendências</h2></div>
          {hub.reminders.length ? hub.reminders.map((r) => { const Icon = KIND_ICON[r.kind]; return <details key={r.kind} className={`hub-task ${r.kind}`} open={r.kind === "conflict" || r.kind === "unconfirmed"}>
            <summary><Icon size={17} aria-hidden="true"/><span><strong>{r.label}</strong><small>{r.hint}</small></span><b>{r.count}</b></summary>
            <ul>{r.items.map((i, n) => <li key={(i.appointmentId || i.requestId || "") + n}><a href={itemHref(i)}><strong>{i.title}</strong><small>{i.detail}</small></a></li>)}</ul>
            {r.count > r.items.length && <p className="hub-task-more">E mais {r.count - r.items.length}. Veja na agenda.</p>}
          </details>; })
            : <div className="hub-allclear"><CheckCircle2 size={28} aria-hidden="true"/><strong>Tudo em dia</strong><span>Nenhuma confirmação, guia, conflito ou sugestão esperando você.</span></div>}
        </aside>}
      </div>
    </main>
  </div>;
}
