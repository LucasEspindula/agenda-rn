import { getSession, isManager } from "@/app/authz";
import { canUseAgenda } from "@/lib/doctor-services";
import { loadAgendaWindow } from "@/lib/agenda/store";
import { visibleState } from "@/lib/security/state";
import { buildAgendaSummary, localDate } from "@/lib/agenda/assistant";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Resumo do dia e lembretes da pessoa logada (assistente da agenda).
// Usa a mesma visibilidade por papel da agenda (visibleState) e das sugestões (/api/workflow).
export async function GET() {
  const session = await getSession();
  if (!session?.account || !canUseAgenda(session)) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const now = new Date(), today = localDate(now);
  const org = session.organization.id, role = session.account.role;
  // Só o que interessa ao resumo: de hoje em diante (a janela reaproveita o cache por revisão).
  const { state } = await loadAgendaWindow(session.account.id, today, org);
  // Sugestões pendentes só para quem decide (o médico não recebe pendências).
  let pending: Record<string, unknown>[] = [];
  if (role !== "doctor") {
    let requests = getSupabaseAdmin().from("agenda_requests")
      .select("id,professional_id,action,status,requested_by,created_at,proposed_payload,previous_payload")
      .eq("organization_id", org).eq("status", "pending");
    if (!isManager(role)) requests = requests.in("professional_id", session.agendaIds);
    const result = await requests.order("created_at", { ascending: true }).limit(200);
    dbError(result.error, "Read pending suggestions");
    pending = result.data || [];
  }
  const summary = buildAgendaSummary({
    state: visibleState(state, session), role, agendaIds: session.agendaIds, userId: session.account.id, now,
    requests: pending,
  });
  return Response.json(summary, { headers: { "Cache-Control": "private, no-store" } });
}
