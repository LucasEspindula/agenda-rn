import { getSession } from "@/app/authz";
import { canUseAgenda } from "@/lib/doctor-services";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session?.account || !canUseAgenda(session)) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const db = getSupabaseAdmin(), role = session.account.role;
  const auditRead = role === "general_manager"
    ? db.from("audit_logs").select("created_at").order("created_at", { ascending: false }).limit(1)
    : role === "secretary" && session.agendaIds.length
      ? db.from("audit_logs").select("created_at").in("professional_id", session.agendaIds).order("created_at", { ascending: false }).limit(1)
      : Promise.resolve({ data: [], error: null });
  const notificationCreatedRead = db.from("notifications").select("created_at").eq("user_id", session.account.id).order("created_at", { ascending: false }).limit(1);
  const notificationReadRead = db.from("notifications").select("read_at").eq("user_id", session.account.id).not("read_at", "is", null).order("read_at", { ascending: false }).limit(1);
  const doctorRequestRead = role === "doctor" && session.agendaIds.length ? db.from("agenda_requests").select("created_at").eq("requested_by", session.account.id).in("professional_id", session.agendaIds).order("created_at", { ascending: false }).limit(1) : Promise.resolve({ data: [], error: null });
  const [stateResult, auditResult, notificationCreatedResult, notificationReadResult, doctorRequestResult] = await Promise.all([
    db.from("app_state").select("updated_at").eq("id", 1).maybeSingle(),
    auditRead,
    notificationCreatedRead,
    notificationReadRead,
    doctorRequestRead,
  ]);
  [stateResult, auditResult, notificationCreatedResult, notificationReadResult, doctorRequestResult].forEach(result => dbError(result.error, "Read synchronization revision"));
  const workflowRevision = [
    auditResult.data?.[0]?.created_at,
    notificationCreatedResult.data?.[0]?.created_at,
    notificationReadResult.data?.[0]?.read_at,
    doctorRequestResult.data?.[0]?.created_at,
  ].filter(Boolean).sort().at(-1) ?? null;
  return Response.json({ revision: stateResult.data?.updated_at ?? null, workflowRevision }, { headers: { "Cache-Control": "private, no-store" } });
}
