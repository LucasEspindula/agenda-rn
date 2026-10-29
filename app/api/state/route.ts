import { readJson, secureMutation } from "@/lib/security/http";
import { mergeState, visibleState } from "@/lib/security/state";
import { hasUnverifiedAttendedTransition } from "@/lib/security/attendance-status";
import { getSession } from "@/app/authz";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";

import {canUseAgenda} from "@/lib/doctor-services";
import {changedAppointmentIssues,type AvailabilityState} from "@/lib/agenda-availability";
type AgendaState = Record<string, unknown> & { appointments?: Record<string, unknown>[]; cancelledAppointments?: Record<string, unknown>[]; patients?: Record<string, unknown>[]; schedulingRules?: Record<string, unknown>[]; scheduleBlocks?: Record<string, unknown>[] };

export async function GET() {
  const session = await getSession();
  if (!session?.account || !canUseAgenda(session)) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const { data: row, error } = await getSupabaseAdmin().from("app_state").select("payload,updated_at,organizations!inner(slug,active)").eq("organizations.slug","rn-gestao").eq("organizations.active",true).maybeSingle();
  dbError(error, "Read application state");
  const state = row ? row.payload as AgendaState : null;
  return Response.json({ state: state ? visibleState(state, session) : null, revision: row?.updated_at ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}

async function putState(request: Request) {
  const session = await getSession();
  if (!session?.account || !canUseAgenda(session)) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const proposed = (await readJson(request, 4 * 1024 * 1024)) as AgendaState;
  const db = getSupabaseAdmin();
  const stateResult = await db.from("app_state").select("payload,updated_at,organizations!inner(slug,active)").eq("organizations.slug","rn-gestao").eq("organizations.active",true).maybeSingle();
  dbError(stateResult.error, "Read application state");
  const row = stateResult.data;
  const suppliedRevision = request.headers.get("if-match");
  if (row ? !suppliedRevision || Date.parse(suppliedRevision) !== Date.parse(row.updated_at) : suppliedRevision !== "new") return Response.json({ error: "A agenda foi atualizada por outra pessoa. Reabra o agendamento e tente novamente." }, { status: 409 });
  const next = mergeState(row?.payload || null, proposed, session) as AgendaState;
  if (hasUnverifiedAttendedTransition((row?.payload as AgendaState)?.appointments || [], next.appointments || [])) {
    return Response.json({ error: "O status Atendido só pode ser alterado mediante senha do médico ou Gerente Geral." }, { status: 403 });
  }
  // Revalidate against the actual merged state, never a stale browser snapshot.
  // Existing appointments that have not changed availability are preserved.
  const unavailable=changedAppointmentIssues((row?.payload||{}) as AvailabilityState,next as AvailabilityState);
  if(unavailable.length)return Response.json({error:"Horário indisponível: "+unavailable[0].problem},{status:409});
  if (session.account.role === "doctor") {
    const minutes = (v: unknown) => String(v).split(":").reduce((h,m)=>h*60+Number(m),0);
    for (const b of proposed.scheduleBlocks || []) if ((row.payload.appointments || []).some((a: Record<string, unknown>) => (a.doctorId === b.professionalId || a.anesthetistId === b.professionalId) && a.date === b.date && a.status !== "cancelled" && minutes(b.start) < minutes(a.time) + Number(a.duration || 0) && minutes(b.end) > minutes(a.time))) return Response.json({ error: "Existe atendimento no horário do bloqueio" }, { status: 409 });
  }
  const revision = new Date(Math.max(Date.now(), row ? Date.parse(row.updated_at) + 1 : 0)).toISOString();
  const entries: Array<Record<string, unknown>> = [];
  if (row) {
    const current = row.payload as AgendaState;
    const before = new Map((current.appointments ?? []).map((item) => [String(item.id), item]));
    const after = new Map((next.appointments ?? []).map((item) => [String(item.id), item]));
    const cancelledBefore = new Map((current.cancelledAppointments ?? []).map((item) => [String(item.id), item]));
    const cancelledAfter = new Map((next.cancelledAppointments ?? []).map((item) => [String(item.id), item]));
    const actor = session.account.name || session.account.email;
    for (const [id, item] of after) {
      const old = before.get(id);
      if (!old || JSON.stringify(old) !== JSON.stringify(item)) entries.push({ id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor, actor_role: session.account.role, action: old ? "appointment_updated" : "appointment_created", professional_id: String(item.doctorId ?? item.anesthetistId ?? "") || null, appointment_id: id, patient_id: String(item.patientId ?? "") || null, description: `${actor} ${old ? "alterou" : "criou"} um agendamento.`, metadata: { before: old || null, after: item } });
    }
    for (const [id, item] of before) if (!after.has(id)) {
      const archived = cancelledAfter.get(id);
      entries.push({ id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor, actor_role: session.account.role, action: archived ? "appointment_cancelled" : "appointment_removed", professional_id: String(item.doctorId ?? item.anesthetistId ?? "") || null, appointment_id: id, patient_id: String(item.patientId ?? "") || null, description: archived ? `${actor} cancelou um agendamento.` : `${actor} removeu um agendamento.`, metadata: { before: item, after: archived || null } });
    }
    for (const [id, item] of cancelledAfter) if (!cancelledBefore.has(id) && !before.has(id)) entries.push({ id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor, actor_role: session.account.role, action: "appointment_cancelled", professional_id: String(item.doctorId ?? item.anesthetistId ?? "") || null, appointment_id: id, patient_id: String(item.patientId ?? "") || null, description: `${actor} registrou um cancelamento.`, metadata: { after: item } });

  }
  const saved = await db.rpc("commit_agenda_change", { p_actor:session.account.id, p_expected: row?.updated_at ?? null, p_payload: next, p_revision: revision, p_audit: entries });
  if(saved.error?.code==='P0001'&&saved.error.message?.includes('Horário indisponível'))return Response.json({error:saved.error.message},{status:409});
  if(saved.error?.code==='P0001'&&saved.error.message?.includes('Nota Fiscal emitida'))return Response.json({error:saved.error.message},{status:409});
  dbError(saved.error, "Save application state and audit");
  if (!saved.data) return Response.json({ error: "Outra pessoa salvou uma alteração. Atualize a agenda antes de salvar novamente." }, { status: 409 });
  return Response.json({ ok: true, revision });
}


export const PUT = secureMutation(putState);
