import { isManager, type Session } from "@/app/authz";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";

// Sugestões de médicos pendentes que a pessoa pode decidir (gerência: todas; secretária: as agendas
// liberadas). O médico não recebe pendências.
export async function loadPendingRequests(session: Session): Promise<Record<string, unknown>[]> {
  const role = session.account.role;
  if (role === "doctor") return [];
  let requests = getSupabaseAdmin().from("agenda_requests")
    .select("id,professional_id,action,status,requested_by,created_at,proposed_payload,previous_payload")
    .eq("organization_id", session.organization.id).eq("status", "pending");
  if (!isManager(role)) requests = requests.in("professional_id", session.agendaIds);
  const result = await requests.order("created_at", { ascending: true }).limit(200);
  dbError(result.error, "Read pending suggestions");
  return result.data || [];
}
