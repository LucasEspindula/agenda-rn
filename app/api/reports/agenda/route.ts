import { getSession, isManager } from "@/app/authz";
import { canUseAgenda } from "@/lib/doctor-services";
import { loadAgendaWindow } from "@/lib/agenda/store";
import { visibleState } from "@/lib/security/state";
import { PRINT_MODES, agendaPeriod, buildAgendaPrint, type PrintMode } from "@/lib/agenda/print";
import { renderAgendaPdf } from "@/lib/reports/agenda-pdf";

export const dynamic = "force-dynamic";
const DATE = /^\d{4}-\d{2}-\d{2}$/, MAX_AGENDAS = 30;

// Agenda em PDF (botão de impressão). Mesmo modelo e layout do PDF enviado por e-mail ao médico.
// Usa a agenda já filtrada por papel; não carrega dados do faturamento.
export async function GET(request: Request) {
  const session = await getSession(), params = new URL(request.url).searchParams;
  if (!session?.account || !canUseAgenda(session)) return Response.json({ error: "Acesso negado." }, { status: 403 });
  const mode = (params.get("period") || "day") as PrintMode, day = params.get("date") || "";
  const ids = [...new Set(params.getAll("professional_id").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean))];
  if (!ids.length || ids.length > MAX_AGENDAS || !DATE.test(day) || !PRINT_MODES.includes(mode))
    return Response.json({ error: "Parâmetros de impressão inválidos." }, { status: 400 });
  if (!isManager(session.account.role) && ids.some((id) => !session.agendaIds.includes(id)))
    return Response.json({ error: "Agenda sem acesso." }, { status: 403 });
  try {
    const { start } = agendaPeriod(mode, day);
    const { state } = await loadAgendaWindow(session.account.id, start, session.organization.id);
    const visible = visibleState(state, session);
    const known = new Set((visible.professionals || []).map((p: { id: unknown }) => String(p.id)));
    if (ids.some((id) => !known.has(id))) return Response.json({ error: "Agenda não encontrada." }, { status: 404 });
    const model = buildAgendaPrint({
      state: visible, professionalIds: ids, mode, date: day,
      organization: session.organization.name, generatedBy: session.account.name, now: new Date(),
    });
    const source = await renderAgendaPdf(model), bytes = new Uint8Array(source.byteLength);
    bytes.set(source);
    const name = `agenda-${model.start}${model.end !== model.start ? "-a-" + model.end : ""}.pdf`;
    return new Response(bytes, { headers: {
      "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return Response.json({ error: "Não foi possível gerar a agenda." }, { status: 503 });
  }
}
