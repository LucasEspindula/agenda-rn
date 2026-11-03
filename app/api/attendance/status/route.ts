import { getSession } from "@/app/authz";
import { verifyPassword } from "@/app/passwords";
import { canUseAgenda } from "@/lib/doctor-services";
import { canReadAppointment, validId } from "@/lib/security/state";
import { touchesAttendedStatus } from "@/lib/security/attendance-status";
import { readJson, secureMutation } from "@/lib/security/http";
import { consumeLimit } from "@/lib/security/rate-limit";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError } from "@/lib/security/http";
import { commitAgendaState, loadAgendaState } from "@/lib/agenda/store";

const statuses = ["scheduled", "confirmed", "authorized", "analysis", "realized"] as const;
type Status = (typeof statuses)[number];
const labels: Record<Status, string> = { scheduled: "Agendado", confirmed: "Confirmado", authorized: "Autorizado", analysis: "Análise", realized: "Atendido" };
type Appointment = Record<string, unknown> & { id: string; status: Status; patientId?: string; doctorId?: string; anesthetistId?: string };
type AgendaState = Record<string, unknown> & { appointments: Appointment[]; patientHistory?: Record<string, unknown>[] };

async function confirmAttendanceStatus(request: Request) {
  const session = await getSession();
  if (!session?.account || !canUseAgenda(session) || !["doctor", "general_manager"].includes(session.account.role)) {
    return Response.json({ error: "Somente médico ou Gerente Geral pode confirmar o atendimento." }, { status: 403 });
  }
  const body = await readJson(request, 4096);
  if (!validId(body.appointmentId) || !statuses.includes(body.status) || typeof body.password !== "string" ||
      body.password.length < 8 || body.password.length > 128) {
    return Response.json({ error: "Informe um agendamento, status e senha válidos." }, { status: 400 });
  }
  const status = body.status as Status;
  if (session.account.role === "doctor" && status !== "realized") {
    return Response.json({ error: "O médico pode confirmar somente o status Atendido." }, { status: 403 });
  }

  // O limite aplica-se também a senhas erradas; a senha nunca é persistida ou auditada.
  await consumeLimit("attendance-status-password", String(session.account.id), 20, 300);
  const db = getSupabaseAdmin();
  const snapshot = await loadAgendaState(session.account.id);
  const state = snapshot.state as AgendaState;
  const current = (state.appointments || []).find((appointment) => appointment.id === body.appointmentId);
  if (!current) return Response.json({ error: "Agendamento não encontrado ou cancelado." }, { status: 404 });
  if (!canReadAppointment(session, current)) return Response.json({ error: "Você não tem acesso a este agendamento." }, { status: 403 });
  if (!touchesAttendedStatus(current, { status })) {
    return Response.json({ error: "Essa alteração não requer confirmação ou o atendimento já está nesse estado." }, { status: 409 });
  }

  const credentials = await db.from("users").select("password_hash,password_salt").eq("id", session.account.id).maybeSingle();
  dbError(credentials.error, "Read password verifier");
  if (!credentials.data?.password_hash || !credentials.data?.password_salt ||
      !await verifyPassword(body.password, credentials.data.password_hash, credentials.data.password_salt)) {
    return Response.json({ error: "Senha incorreta. Confira a senha da sua própria conta." }, { status: 401 });
  }

  const now = new Date().toISOString();
  const updated: Appointment = { ...current, status, statusUpdatedAt: now };
  const next: AgendaState = {
    ...state,
    appointments: state.appointments.map((appointment) => appointment.id === current.id ? updated : appointment),
    patientHistory: current.patientId
      ? [...(state.patientHistory || []), {
          id: crypto.randomUUID(), patientId: current.patientId, type: "Status alterado",
          text: `${labels[current.status] || current.status} → ${labels[status]}`, appointmentId: current.id, at: now,
        }]
      : state.patientHistory,
  };
  const actor = session.account.name || session.account.email;
  let saved: { ok: boolean; revision?: string };
  try { saved = await commitAgendaState(session.account.id, snapshot.revision, state, next, {
    audit: [{
      id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor,
      actor_role: session.account.role, action: "appointment_updated",
      professional_id: current.doctorId || current.anesthetistId || null,
      appointment_id: current.id, patient_id: current.patientId || null,
      description: `${actor} alterou o status do agendamento com confirmação por senha.`,
      metadata: { before: current, after: updated, passwordConfirmed: true },
    }],
  }); } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  if (!saved.ok) return Response.json({ error: "A agenda mudou. Atualize e tente novamente." }, { status: 409 });
  return Response.json({ ok: true, revision: saved.revision, status });
}

export const POST = secureMutation(confirmAttendanceStatus);
