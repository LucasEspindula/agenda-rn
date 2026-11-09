import { readJson, secureMutation } from "@/lib/security/http";
import { mergeState, visibleState } from "@/lib/security/state";
import { hasUnverifiedAttendedTransition } from "@/lib/security/attendance-status";
import { getSession } from "@/app/authz";
import { HttpError } from "@/lib/security/http";
import { applyAgendaChanges, loadAgendaState, loadAgendaWindow, parseAgendaSince, rowBases } from "@/lib/agenda/store";
import { agendaOps, canonical, changedKeys, conflictingKey, rebase } from "@/lib/agenda/diff";

import {canUseAgenda} from "@/lib/doctor-services";
import {changedAppointmentIssues,type AvailabilityState} from "@/lib/agenda-availability";
type AgendaState = Record<string, unknown> & { appointments?: Record<string, unknown>[]; cancelledAppointments?: Record<string, unknown>[]; patients?: Record<string, unknown>[]; schedulingRules?: Record<string, unknown>[]; scheduleBlocks?: Record<string, unknown>[] };

// O navegador recebe só o período pedido (?since=AAAA-MM-DD ou ?since=all); padrão: 90 dias + futuro.
// Gravações usam o estado completo do servidor e nunca removem consultas/pacientes por ausência.
export async function GET(request?: Request) {
  const session = await getSession();
  if (!session?.account || !canUseAgenda(session)) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const since = parseAgendaSince(request ? new URL(request.url).searchParams.get("since") : null);
  const { state, revision } = await loadAgendaWindow(session.account.id, since, session.organization.id);
  return Response.json({ state: visibleState(state, session), revision, window: { since: since ?? "all" } }, { headers: { "Cache-Control": "private, no-store" } });
}

async function putState(request: Request) {
  const session = await getSession();
  if (!session?.account || !canUseAgenda(session)) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const proposed = (await readJson(request, 4 * 1024 * 1024)) as AgendaState;
  const snapshot = await loadAgendaState(session.account.id, session.organization.id);
  const current = snapshot.state as AgendaState;
  const suppliedRevision = request.headers.get("if-match");
  // A revisão informada é a leitura do usuário: base do merge por registro.
  if (!suppliedRevision || !Number.isFinite(Date.parse(suppliedRevision))) return Response.json({ error: "A agenda foi atualizada. Atualize a página antes de salvar." }, { status: 409 });
  const baseRevision = new Date(Date.parse(suppliedRevision)).toISOString();
  const bases = await rowBases(session.account.id, baseRevision, changedKeys(current, proposed), session.organization.id);
  const next = mergeState(current, rebase(current, proposed, bases), session) as AgendaState;
  const conflict = conflictingKey(current, next, bases);
  if (conflict) return Response.json({ error: "Este registro foi alterado por outra pessoa. Reabra e tente novamente." }, { status: 409 });
  if (hasUnverifiedAttendedTransition(current.appointments || [], next.appointments || [])) {
    return Response.json({ error: "O status Atendido só pode ser alterado mediante senha do médico ou Gerente Geral." }, { status: 403 });
  }
  // Revalidate against the actual merged state, never a stale browser snapshot.
  // Existing appointments that have not changed availability are preserved.
  const unavailable=changedAppointmentIssues(current as AvailabilityState,next as AvailabilityState);
  if(unavailable.length)return Response.json({error:"Horário indisponível: "+unavailable[0].problem},{status:409});
  if (session.account.role === "doctor") {
    const minutes = (v: unknown) => String(v).split(":").reduce((h,m)=>h*60+Number(m),0);
    for (const b of proposed.scheduleBlocks || []) if ((current.appointments || []).some((a: Record<string, unknown>) => (a.doctorId === b.professionalId || a.anesthetistId === b.professionalId) && a.date === b.date && a.status !== "cancelled" && minutes(b.start) < minutes(a.time) + Number(a.duration || 0) && minutes(b.end) > minutes(a.time))) return Response.json({ error: "Existe atendimento no horário do bloqueio" }, { status: 409 });
  }
  const entries: Array<Record<string, unknown>> = [];
  {
    const before = new Map((current.appointments ?? []).map((item) => [String(item.id), item]));
    const after = new Map((next.appointments ?? []).map((item) => [String(item.id), item]));
    const cancelledBefore = new Map((current.cancelledAppointments ?? []).map((item) => [String(item.id), item]));
    const cancelledAfter = new Map((next.cancelledAppointments ?? []).map((item) => [String(item.id), item]));
    const actor = session.account.name || session.account.email;
    for (const [id, item] of after) {
      const old = before.get(id);
      if (!old || canonical("appointments", old) !== canonical("appointments", item)) entries.push({ id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor, actor_role: session.account.role, action: old ? "appointment_updated" : "appointment_created", professional_id: String(item.doctorId ?? item.anesthetistId ?? "") || null, appointment_id: id, patient_id: String(item.patientId ?? "") || null, description: `${actor} ${old ? "alterou" : "criou"} um agendamento.`, metadata: { before: old || null, after: item } });
    }
    for (const [id, item] of before) if (!after.has(id)) {
      const archived = cancelledAfter.get(id);
      entries.push({ id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor, actor_role: session.account.role, action: archived ? "appointment_cancelled" : "appointment_removed", professional_id: String(item.doctorId ?? item.anesthetistId ?? "") || null, appointment_id: id, patient_id: String(item.patientId ?? "") || null, description: archived ? `${actor} cancelou um agendamento.` : `${actor} removeu um agendamento.`, metadata: { before: item, after: archived || null } });
    }
    for (const [id, item] of cancelledAfter) if (!cancelledBefore.has(id) && !before.has(id)) entries.push({ id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor, actor_role: session.account.role, action: "appointment_cancelled", professional_id: String(item.doctorId ?? item.anesthetistId ?? "") || null, appointment_id: id, patient_id: String(item.patientId ?? "") || null, description: `${actor} registrou um cancelamento.`, metadata: { after: item } });

  }
  const ops = agendaOps(current, next, bases);
  // O navegador pode não ter as consultas antigas: o uso do hospital é conferido no estado completo.
  const archivedHospitals = new Set(ops.filter(op => op.op === "archive_hospital").map(op => String(op.id)));
  if (archivedHospitals.size && [...(next.appointments || []), ...(next.cancelledAppointments || [])].some(a => archivedHospitals.has(String(a.hospitalId))))
    return Response.json({ error: "Esse hospital está vinculado a agendamentos e não pode ser removido." }, { status: 409 });
  if (!ops.length) return Response.json({ ok: true, revision: snapshot.revision });
  try {
    const saved = await applyAgendaChanges(session.account.id, ops, { audit: entries, org: session.organization.id });
    return Response.json({ ok: true, revision: saved.revision });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}


export const PUT = secureMutation(putState);
