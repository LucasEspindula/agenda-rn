import { getSession, isManager } from "@/app/authz";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";

type AgendaState = Record<string, unknown> & { appointments?: Record<string, unknown>[]; cancelledAppointments?: Record<string, unknown>[]; patients?: Record<string, unknown>[]; schedulingRules?: Record<string, unknown>[]; scheduleBlocks?: Record<string, unknown>[] };

function belongsToAgenda(item: Record<string, unknown>, allowed: Set<string>) {
  return allowed.has(String(item.doctorId ?? item.professionalId ?? "")) || allowed.has(String(item.anesthetistId ?? ""));
}

export async function GET() {
  const session = await getSession();
  if (!session?.account) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const { data: row, error } = await getSupabaseAdmin().from("app_state").select("payload").eq("id", 1).maybeSingle();
  dbError(error, "Read application state");
  const state = row ? row.payload as AgendaState : null;
  if (!state || isManager(session.account.role)) return Response.json({ state });
  const allowed = new Set<string>(session.agendaIds);
  const allowedPatientIds = new Set<string>((state.appointments ?? []).filter((item) => allowed.has(String(item.doctorId ?? ""))).map((item) => String(item.patientId ?? "")));
  return Response.json({ state: { ...state,
    patients: (state.patients ?? []).filter((item) => allowed.has(String(item.doctorId ?? "")) || allowedPatientIds.has(String(item.id ?? ""))),
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
  const stateResult = await db.from("app_state").select("payload").eq("id", 1).maybeSingle();
  dbError(stateResult.error, "Read application state");
  const row = stateResult.data;
  if (session.account.role === "doctor") return Response.json({ ok: true, ignored: true });
  let next = proposed;
  if (row && !isManager(session.account.role)) {
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
  const saved = await db.from("app_state").upsert({ id: 1, payload: next, updated_at: new Date().toISOString() });
  dbError(saved.error, "Save application state");
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
  return Response.json({ ok: true });
}
