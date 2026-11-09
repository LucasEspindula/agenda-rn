import {canUseAgenda} from "@/lib/doctor-services";
import {changedAppointmentIssues,type AvailabilityState} from "@/lib/agenda-availability";
import { canReadAppointment, withoutLegacyFinance, validateAppointment, validId } from "@/lib/security/state";
import { consumeLimit } from "@/lib/security/rate-limit";
import { readJson, secureMutation } from "@/lib/security/http";
import { getSession, isManager } from "@/app/authz";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";
import { HttpError } from "@/lib/security/http";
import { canonical } from "@/lib/agenda/diff";
import { commitAgendaState, loadAgendaState } from "@/lib/agenda/store";

type Appointment = Record<string, unknown> & { id: string; doctorId?: string; anesthetistId?: string | null; patientId?: string; date?: string; time?: string; duration?: number; status?: string };
type AgendaState = Record<string, unknown> & { appointments?: Appointment[]; cancelledAppointments?: Appointment[]; patients?: Array<Record<string, unknown>>; professionals?: Array<Record<string, unknown>> };
type DecisionAudit = {actor_name:string;actor_role:string;action:string;metadata:Record<string,unknown>|null};

function allowed(session: NonNullable<Awaited<ReturnType<typeof getSession>>>, professionalId: string) {
  return isManager(session.account.role) || session.agendaIds.includes(professionalId);
}

function appointmentProfessional(a: Appointment) { return String(a.doctorId || a.anesthetistId || ""); }
function personName(state: AgendaState, key: "patients" | "professionals", id: unknown) {
  return String(state[key]?.find((item) => String(item.id) === String(id))?.name || "");
}
function requestDescription(state: AgendaState, actor: string, action: string, proposed: Appointment | null, previous: Appointment | null) {
  const a = proposed || previous;
  const patient = personName(state, "patients", a?.patientId) || "paciente";
  if (action === "delete") return `${actor} sugeriu desagendar ${patient} de ${a?.date || "—"} às ${a?.time || "—"}.`;
  if (action === "update") return `${actor} sugeriu alterar ${patient} para ${a?.date || "—"} às ${a?.time || "—"}.`;
  return `${actor} sugeriu agendar ${patient} para ${a?.date || "—"} às ${a?.time || "—"}.`;
}
function overlaps(a: Appointment, b: Appointment) {
  if (a.id === b.id || a.status === "cancelled" || b.status === "cancelled" || a.doctorId !== b.doctorId || a.date !== b.date) return false;
  const toMinutes = (value: unknown) => { const [h, m] = String(value || "00:00").split(":").map(Number); return h * 60 + m; };
  const aStart = toMinutes(a.time), bStart = toMinutes(b.time);
  return aStart < bStart + Number(b.duration || 60) && aStart + Number(a.duration || 60) > bStart;
}

export async function GET() {
  const session = await getSession();
  if (!session?.account || !canUseAgenda(session)) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const db = getSupabaseAdmin();
  const org = session.organization.id;
  let requestQuery = db.from("agenda_requests").select("*").eq("organization_id", org);
  if (session.account.role === "doctor") requestQuery = requestQuery.eq("requested_by", session.account.id).in("professional_id", session.agendaIds);
  else if (!isManager(session.account.role)) requestQuery = requestQuery.in("professional_id", session.agendaIds);
  const [requestRows, userRows, notificationRows] = await Promise.all([
    requestQuery.order("created_at", { ascending: false }).limit(200),
    // Nomes apenas de quem pertence à organização da sessão.
    db.from("organization_memberships").select("users!inner(id,name,email)").eq("organization_id", org),
    db.from("notifications").select("*").eq("organization_id", org).eq("user_id", session.account.id).order("created_at", { ascending: false }).limit(100),
  ]);
  [requestRows, userRows, notificationRows].forEach((result) => dbError(result.error, "Read workflow"));
  // Supabase schema types are generated after the first production migration.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests = (requestRows.data || []) as Array<Record<string, any>>, users = ((userRows.data || []) as Array<Record<string, any>>).map((row) => (Array.isArray(row.users) ? row.users[0] : row.users) || {}), notifications = (notificationRows.data || []) as Array<Record<string, any>>;
  const names = new Map(users.map((user) => [Number(user.id), user.name || user.email]));
  const scopedRequests = session.account.role === "doctor" ? requests.map(withoutLegacyFinance) : requests;
  const visibleRequests = scopedRequests.filter((row) => session.account.role === "doctor" ? Number(row.requested_by) === session.account.id && allowed(session,row.professional_id) : allowed(session, row.professional_id));
  let decisionAuditRows: DecisionAudit[] = [];
  if (visibleRequests.length) {
    const visibleRequestIds = visibleRequests.map((row) => String(row.id));
    let decisionQuery = db.from("audit_logs").select("actor_name,actor_role,action,metadata").eq("organization_id", org).in("action", ["request_accepted", "request_denied"]).in("metadata->>requestId", visibleRequestIds);
    if (!isManager(session.account.role)) decisionQuery = decisionQuery.in("professional_id", session.agendaIds);
    const decisionAudits = await decisionQuery;
    dbError(decisionAudits.error, "Read decision authorship");
    decisionAuditRows = (decisionAudits.data || []) as DecisionAudit[];
  }
  const decisionAuditsByRequest = new Map<string, (typeof decisionAuditRows)[number]>();
  decisionAuditRows.forEach((row) => {
    const metadata = (row.metadata || {}) as Record<string, unknown>;
    const requestId = typeof metadata.requestId === "string" ? metadata.requestId : null;
    if (requestId && (row.action === "request_accepted" || row.action === "request_denied") && !decisionAuditsByRequest.has(requestId)) decisionAuditsByRequest.set(requestId, row);
  });
  return Response.json({
    requests: visibleRequests.map((row) => {
      const decisionAudit = decisionAuditsByRequest.get(String(row.id));
      const deciderName = row.decided_by ? names.get(Number(row.decided_by)) : null;
      return { ...row, requestedBy: Number(row.requested_by), decidedBy: row.decided_by ? Number(row.decided_by) : null, professionalId: row.professional_id, appointmentId: row.appointment_id, createdAt: row.created_at, decidedAt: row.decided_at, decisionNote: row.decision_note, requesterName: names.get(Number(row.requested_by)), deciderName: decisionAudit?.actor_name || deciderName || null, deciderRole: decisionAudit?.actor_role || null, proposed: row.proposed_payload || null, previous: row.previous_payload || null };
    }),
    notifications: notifications.map((row) => ({ ...row, readAt: row.read_at, createdAt: row.created_at, requestId: row.request_id })),
    // Logs are loaded separately and lazily by /api/workflow/logs.
    audit: [],
  });
}

async function handlePOST(request: Request) {
  const session = await getSession();
  if (!session?.account || session.account.role !== "doctor" || !canUseAgenda(session)) return Response.json({ error: "Somente médicos com Agendamento habilitado enviam sugestões de agenda" }, { status: 403 });
  await consumeLimit("workflow", String(session.account.id), 30, 300);
  const body = await readJson(request) as { action?: "create" | "update" | "delete"; appointment?: Appointment; appointmentId?: string };
  if (!body.action || !["create", "update", "delete"].includes(body.action)) return Response.json({ error: "Solicitação inválida" }, { status: 400 });
  const db = getSupabaseAdmin();
  const state = (await loadAgendaState(session.account.id, session.organization.id)).state as AgendaState;
  const previous = state.appointments?.find((item) => item.id === (body.appointmentId || body.appointment?.id)) || null;
  const proposed = body.appointment || null;
  if (body.action !== "create" && previous && !canReadAppointment(session, previous)) return Response.json({ error: "Agendamento sem permissão" }, { status: 403 });
  if (!proposed) return Response.json({ error: "Agendamento inválido" }, { status: 400 });
  validateAppointment(proposed);
  if (body.action !== "delete" && proposed.status === "realized" && previous?.status !== "realized") return Response.json({ error: "Alteração para/de Atendido exige senha do médico ou Gerente Geral." }, { status: 403 });
  if (body.action === "create" && [...(state.appointments || []),...(state.cancelledAppointments || [])].some(a=>a.id===proposed.id)) return Response.json({error:"Identificador já utilizado"},{status:409});
  if (previous && (proposed.id !== previous.id || proposed.doctorId !== previous.doctorId || proposed.anesthetistId !== previous.anesthetistId || proposed.patientId !== previous.patientId)) return Response.json({error:"Transferência de agendamento exige a gerência"},{status:403});
  if (!previous && proposed.patientId && !(state.patients || []).some(p=>p.id===proposed.patientId && session.agendaIds.includes(String(p.doctorId)))) return Response.json({error:"Paciente sem permissão"},{status:403});
  if (!previous && [proposed.doctorId,proposed.anesthetistId].some(id=>id && !session.agendaIds.includes(id))) return Response.json({error:"Novo vínculo exige acesso às agendas envolvidas"},{status:403});
  proposed.suggestedByName = session.account.name || session.account.email;
  proposed.suggestedByEmail = session.account.email;
  const professionalId = appointmentProfessional(proposed || previous || { id: "" });
  if (!professionalId || !allowed(session, professionalId)) return Response.json({ error: "Você não possui acesso a esta agenda" }, { status: 403 });
  if (body.action !== "create" && !previous) return Response.json({ error: "Agendamento não encontrado" }, { status: 404 });
  if (!proposed.date || !proposed.time) return Response.json({ error: "Preencha paciente, data e horário" }, { status: 400 });
  const targetAppointmentId = previous?.id || proposed?.id || null;
  const duplicate = await db.from("agenda_requests").select("id").eq("requested_by", session.account.id).eq("action", body.action).eq("appointment_id", targetAppointmentId).eq("status", "pending").maybeSingle();
  dbError(duplicate.error, "Check duplicate workflow request");
  if (duplicate.data) return Response.json({ ok: true, id: duplicate.data.id, message: "Sugestão já enviada. Aguarde aprovação." });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const actor = session.account.name || session.account.email;
  const description = requestDescription(state, actor, body.action, proposed, previous);
  // A solicitação, a notificação e a auditoria são uma única transação.
  // Criá-las em Promise.all permite que a notificação ultrapasse o pedido (FK 23503).
  const { data: savedId, error } = await db.rpc("submit_agenda_suggestion", {
    p_org: session.organization.id,
    p_request: { id, professional_id: professionalId, appointment_id: targetAppointmentId, action: body.action, proposed_payload: proposed, previous_payload: previous, requested_by: session.account.id, created_at: now },
    p_notification: { id: crypto.randomUUID(), user_id: session.account.id, type: "request_sent", request_id: id, message: "Alteração de agenda enviada.", created_at: now },
    p_audit: { id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor, actor_role: session.account.role, action: "request_created", professional_id: professionalId, appointment_id: previous?.id || proposed?.id || null, patient_id: String((proposed || previous)?.patientId || "") || null, description, metadata: { requestId: id, requestAction: body.action }, created_at: now },
  });
  dbError(error, "Create workflow request");
  return Response.json({ ok: true, id: savedId, message: savedId === id ? "Alteração de agenda enviada." : "Sugestão já enviada. Aguarde aprovação." });
}

async function handlePATCH(request: Request) {
  const session = await getSession();
  if (!session?.account || session.account.role === "doctor") return Response.json({ error: "Sem permissão para decidir solicitações" }, { status: 403 });
  const body = await readJson(request) as { id?: string; decision?: "accepted" | "denied"; note?: string };
  if (!validId(body.id) || (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 2000)) || !["accepted", "denied"].includes(body.decision || "")) return Response.json({ error: "Decisão inválida" }, { status: 400 });
  if (body.decision === "denied" && !body.note?.trim()) return Response.json({ error: "Informe o motivo da recusa" }, { status: 400 });
  const db = getSupabaseAdmin();
  const requestResult = await db.from("agenda_requests").select("*").eq("organization_id", session.organization.id).eq("id", body.id).eq("status", "pending").maybeSingle(); dbError(requestResult.error, "Read request"); const row = requestResult.data;
  if (!row) return Response.json({ error: "Esta solicitação já foi decidida ou não existe" }, { status: 409 });
  if (!allowed(session, row.professional_id)) return Response.json({ error: "Você não possui acesso a esta agenda" }, { status: 403 });
  const snapshot = await loadAgendaState(session.account.id, session.organization.id);
  const before = snapshot.state as AgendaState;
  const state = structuredClone(before) as AgendaState;
  const proposed = row.proposed_payload as Appointment | null;
  const previous = row.previous_payload as Appointment | null;
  const now = new Date().toISOString();
  if (body.decision === "accepted") {
    const current = state.appointments || [];
    const original = current.find(a=>a.id===row.appointment_id);
    if (original && (!canReadAppointment(session,original) || !previous || canonical("appointments",original)!==canonical("appointments",previous))) return Response.json({error:"Agendamento mudou ou acesso foi revogado; envie uma nova sugestão"},{status:409});
    if (!proposed) return Response.json({error:"Solicitação inválida"},{status:400});
    validateAppointment(proposed);
    if (row.action !== "delete" && proposed.status === "realized" && previous?.status !== "realized") return Response.json({ error: "A mudança para/de Atendido exige confirmação por senha diretamente no agendamento." }, { status: 403 });
    if (!canReadAppointment(session,proposed) || (previous && (proposed.id!==previous.id || proposed.doctorId!==previous.doctorId || proposed.anesthetistId!==previous.anesthetistId || proposed.patientId!==previous.patientId))) return Response.json({error:"Vínculo da solicitação inválido"},{status:403});
    if (row.action==="create" && [...current,...(state.cancelledAppointments || [])].some(a=>a.id===proposed.id)) return Response.json({error:"Identificador já utilizado"},{status:409});
    if (row.action !== "create" && !current.some((a) => a.id === row.appointment_id)) return Response.json({ error: "O agendamento original já foi alterado. Negue a solicitação e peça uma nova sugestão." }, { status: 409 });
    if (proposed && current.some((a) => overlaps(proposed, a))) return Response.json({ error: "O horário ficou indisponível. A solicitação não foi aplicada." }, { status: 409 });
    if (row.action === "delete") {
      const archived = { ...(previous || proposed!), ...(proposed || {}), cancelledAt: String(proposed?.cancelledAt || now), cancelReason: String(proposed?.cancelReason || "Não informado") };
      state.appointments = current.filter((a) => a.id !== row.appointment_id);
      state.cancelledAppointments = [...(state.cancelledAppointments || []).filter((a) => a.id !== archived.id), archived];
    }
    else if (row.action === "update") state.appointments = current.map((a) => a.id === row.appointment_id ? proposed! : a);
    else state.appointments = [...current, proposed!];
  }
  if(body.decision==="accepted"){
    const unavailable=changedAppointmentIssues(before as AvailabilityState,state as AvailabilityState);
    if(unavailable.length)return Response.json({error:"Horário indisponível: "+unavailable[0].problem},{status:409});
  }
  const actor = session.account.name || session.account.email;
  const patient = personName(state, "patients", (proposed || previous)?.patientId) || "paciente";
  const accepted = body.decision === "accepted";
  const description = `${actor} ${accepted ? "aceitou" : "negou"} a sugestão de ${row.action === "delete" ? "desagendamento" : "alteração"} de ${patient}.`;
  let result: { ok: boolean };
  try { result = await commitAgendaState(session.account.id, snapshot.revision, before, accepted ? state : before, {
    org: session.organization.id, requestId: row.id, decision: body.decision as "accepted" | "denied", note: body.note?.trim() || null,
    notification: { id: crypto.randomUUID(), user_id: row.requested_by, type: accepted ? "request_accepted" : "request_denied", message: `Alteração de agenda ${accepted ? "aceita" : "negada"}.` },
    audit: [{ id: crypto.randomUUID(), actor_user_id: session.account.id, actor_name: actor, actor_role: session.account.role, action: accepted ? "request_accepted" : "request_denied", professional_id: row.professional_id, appointment_id: row.appointment_id, patient_id: (proposed || previous)?.patientId || null, description, metadata: { requestId: row.id, note: body.note?.trim() || null } }],
  }); } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
  if (!result.ok) return Response.json({error:"Agenda ou solicitação mudou. Atualize e tente novamente."},{status:409});
  return Response.json({ ok: true, message: `Alteração de agenda ${accepted ? "aceita" : "negada"}.` });
}

async function handleDELETE() {
  const session = await getSession();
  if (!session?.account || !canUseAgenda(session)) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const result = await getSupabaseAdmin().from("notifications").update({ read_at: new Date().toISOString() }).eq("organization_id", session.organization.id).eq("user_id", session.account.id).is("read_at", null); dbError(result.error, "Mark notifications read");
  return Response.json({ ok: true });
}


export const POST = secureMutation(handlePOST);
export const PATCH = secureMutation(handlePATCH);
export const DELETE = secureMutation(handleDELETE);
