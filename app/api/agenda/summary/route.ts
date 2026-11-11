import { getSession } from "@/app/authz";
import { canUseAgenda } from "@/lib/doctor-services";
import { loadAgendaWindow } from "@/lib/agenda/store";
import { visibleState } from "@/lib/security/state";
import { buildAgendaSummary, localDate } from "@/lib/agenda/assistant";
import { loadPendingRequests } from "@/lib/agenda/pending-requests";

export const dynamic = "force-dynamic";

// Resumo do dia e lembretes da pessoa logada (a tela é o Hub; esta rota serve integrações).
// Usa a mesma visibilidade por papel da agenda (visibleState) e das sugestões (/api/workflow).
export async function GET() {
  const session = await getSession();
  if (!session?.account || !canUseAgenda(session)) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const now = new Date(), today = localDate(now);
  // Só o que interessa ao resumo: de hoje em diante (a janela reaproveita o cache por revisão).
  const { state } = await loadAgendaWindow(session.account.id, today, session.organization.id);
  // Sugestões pendentes só para quem decide (o médico não recebe pendências).
  const pending = await loadPendingRequests(session);
  const summary = buildAgendaSummary({
    state: visibleState(state, session), role: session.account.role, agendaIds: session.agendaIds, userId: session.account.id, now,
    requests: pending,
  });
  return Response.json(summary, { headers: { "Cache-Control": "private, no-store" } });
}
