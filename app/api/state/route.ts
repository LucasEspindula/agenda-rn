import { getSession, isManager } from "@/app/authz";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";

type AgendaState = Record<string, unknown> & { appointments?: Record<string, unknown>[]; cancelledAppointments?: Record<string, unknown>[]; patients?: Record<string, unknown>[]; schedulingRules?: Record<string, unknown>[]; scheduleBlocks?: Record<string, unknown>[] };

function belongsToAgenda(item: Record<string, unknown>, allowed: Set<string>) {
  return allowed.has(String(item.doctorId ?? item.professionalId ?? "")) || allowed.has(String(item.anesthetistId ?? ""));
}

export async function GET() {
  const session = await getSession();
  if (!session?.account) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const { data: row, error } = await getSupabaseAdmin().from("app_state").select("payload,updated_at").eq("id", 1).maybeSingle();
  dbError(error, "Read application state");
  const state = row ? row.payload as AgendaState : null;
  if (!state || isManager(session.account.role)) return Response.json({ state, revision: row?.updated_at ?? null });
  const allowed = new Set<string>(session.agendaIds);
  const allowedPatientIds = new Set<string>((state.appointments ?? []).filter((item) => allowed.has(String(item.doctorId ?? ""))).map((item) => String(item.patientId ?? "")));
  return Response.json({ revision: row?.updated_at ?? null, state: { ...state,
    patients: (state.patients ?? []).filter((item) => allowed.has(String(item.doctorId ?? "")) || allowedPatientIds.has(String(item.id ?? ""))),
    patientHistory: ((state.patientHistory ?? []) as Record<string, unknown>[]).filter((item) => (state.patients ?? []).some((p) => p.id === item.patientId && (allowed.has(String(p.doctorId ?? "")) || allowedPatientIds.has(String(p.id ?? ""))))),
    appointments: (state.appointments ?? []).filter((item) => belongsToAgenda(item, allowed)),
    cancelledAppointments: (state.cancelledAppointments ?? []).filter((item) => belongsToAgenda(item, allowed)),
    schedulingRules: (state.schedulingRules ?? []).filter((item) => allowed.has(String(item.professionalId ?? ""))),
    scheduleBlocks: (state.scheduleBlocks ?? []).filter((item) => allowed.has(String(item.professionalId ?? ""))),
  } });
}

export async function PUT(request: Request) {
  const session = await getSession();
  if (!session?.account) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const proposed = (await request.json()) as AgendaState;
  const db = getSupabaseAdmin();
  const stateResult = await db.from("app_state").select("payload,updated_at").eq("id", 1).maybeSingle();
  dbError(stateResult.error, "Read application state");
  const row = stateResult.data;
  const suppliedRevision = request.headers.get("if-match");
  if (row ? !suppliedRevision || Date.parse(suppliedRevision) !== Date.parse(row.updated_at) : suppliedRevision !== "new") return Response.json({ error: "A agenda foi atualizada por outra pessoa. Reabra o agendamento e tente novamente." }, { status: 409 });
  let next = proposed;
  if (session.account.role === "doctor") {
    if (!row) return Response.json({ error: "Agenda não disponível" }, { status: 409 });
    const current = row.payload as AgendaState;
    const allowed = new Set<string>(session.agendaIds);
    const blocks = proposed.scheduleBlocks;
    if (!Array.isArray(blocks)) return Response.json({ error: "Bloqueios inválidos" }, { status: 400 });
    const retained = (current.scheduleBlocks ?? []).filter(b => !allowed.has(String(b.professionalId)));
    const ids = new Set(retained.map(b => String(b.id)));
    for (const b of blocks) {
      if (!b || !allowed.has(String(b.professionalId)) || !b.id || ids.has(String(b.id)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.start)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.end)) || String(b.start) >= String(b.end) || !String(b.reason ?? "").trim()) return Response.json({ error: "Bloqueio inválido ou agenda sem permissão" }, { status: 400 });
      ids.add(String(b.id));
      const minutes = (v: unknown) => String(v).split(":").reduce((h, m) => h * 60 + Number(m), 0);
      if ((current.appointments ?? []).some(a => (a.doctorId === b.professionalId || a.anesthetistId === b.professionalId) && a.date === b.date && a.status !== "cancelled" && minutes(b.start) < minutes(a.time) + Number(a.duration || 0) && minutes(b.end) > minutes(a.time))) return Response.json({ error: "Existe atendimento no horário do bloqueio" }, { status: 409 });
    }
    next = { ...current, scheduleBlocks: [...retained, ...blocks] };
  } else if (row && !isManager(session.account.role)) {
    const current = row.payload as AgendaState;
    const allowed = new Set<string>(session.agendaIds);
    const retained = (current.appointments ?? []).filter((item) => !belongsToAgenda(item, allowed));
    const permitted = (proposed.appointments ?? []).filter((item) => belongsToAgenda(item, allowed));
    const retainedCancelled = (current.cancelledAppointments ?? []).filter((item) => !belongsToAgenda(item, allowed));
    const permittedCancelled = (proposed.cancelledAppointments ?? []).filter((item) => belongsToAgenda(item, allowed));
    const retainedPatients = (current.patients ?? []).filter((item) => !allowed.has(String(item.doctorId ?? "")));
    const permittedPatients = (proposed.patients ?? []).filter((item) => allowed.has(String(item.doctorId ?? "")));
    next = { ...proposed, professionals: current.professionals, hospitals: current.hospitals, settings: current.settings,
      schedulingRules: current.schedulingRules, scheduleBlocks: current.scheduleBlocks, appointments: [...retained, ...permitted], cancelledAppointments: [...retainedCancelled, ...permittedCancelled], patients: [...retainedPatients, ...permittedPatients] };
  }
  const revision = new Date(Math.max(Date.now(), row ? Date.parse(row.updated_at) + 1 : 0)).toISOString();
  const saved = row
    ? await db.from("app_state").update({ payload: next, updated_at: revision }).eq("id", 1).eq("updated_at", row.updated_at).select("id").maybeSingle()
    : await db.from("app_state").insert({ id: 1, payload: next, updated_at: revision }).select("id").maybeSingle();
  dbError(saved.error, "Save application state");
  if (!saved.data) return Response.json({ error: "Outra pessoa salvou uma alteração. Atualize a agenda antes de salvar novamente." }, { status: 409 });
  if (row) {
    const current = row.payload as AgendaState;
    const before = new Map((current.appointments ?? []).map((item) => [String(item.id), item]));
    const after = new Map((next.appointments ?? []).map((item) => [String(item.id), item]));
    const cancelledBefore = new Map((current.cancelledAppointments ?? []).map((item) => [String(item.id), item]));
    const cancelledAfter = new Map((next.cancelledAppointments ?? []).map((item) => [String(item.id), item]));
    const actor = session.account.name || session.account.email;
    const entries: Array<Record<string, unknown>> = [];
    for (const [id, item] of after) {
      const old = before.get(id);
      if (!old || JSON.stringify(old) !== JSON.stringify(item)) entries.push({ id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor, actor_role: session.account.role, action: old ? "appointment_updated" : "appointment_created", professional_id: String(item.doctorId ?? item.anesthetistId ?? "") || null, appointment_id: id, patient_id: String(item.patientId ?? "") || null, description: `${actor} ${old ? "alterou" : "criou"} um agendamento.`, metadata: { before: old || null, after: item } });
    }
    for (const [id, item] of before) if (!after.has(id)) {
      const archived = cancelledAfter.get(id);
      entries.push({ id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor, actor_role: session.account.role, action: archived ? "appointment_cancelled" : "appointment_removed", professional_id: String(item.doctorId ?? item.anesthetistId ?? "") || null, appointment_id: id, patient_id: String(item.patientId ?? "") || null, description: archived ? `${actor} cancelou um agendamento.` : `${actor} removeu um agendamento.`, metadata: { before: item, after: archived || null } });
    }
    for (const [id, item] of cancelledAfter) if (!cancelledBefore.has(id) && !before.has(id)) entries.push({ id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor, actor_role: session.account.role, action: "appointment_cancelled", professional_id: String(item.doctorId ?? item.anesthetistId ?? "") || null, appointment_id: id, patient_id: String(item.patientId ?? "") || null, description: `${actor} registrou um cancelamento.`, metadata: { after: item } });
    if (entries.length) { const audit = await db.from("audit_logs").insert(entries); dbError(audit.error, "Write audit log"); }
  }
  return Response.json({ ok: true, revision });
}
