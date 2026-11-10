import { cronAuthError } from "@/lib/security/cron";
import { runMonitor } from "@/lib/monitor/runner";
import { reportError } from "@/lib/monitor/report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Rodada do assistente de monitoramento. Chamada a cada 15 min pelo GitHub Actions
// (.github/workflows/monitor.yml) e 1x/dia pela Vercel, como reserva.
// Responde 503 quando há problema crítico, para a verificação agendada falhar e o GitHub avisar.
export async function GET(request: Request) {
  const denied = cronAuthError(request);
  if (denied) return denied;
  try {
    const summary = await runMonitor();
    return Response.json(summary, { status: summary.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await reportError(error, { source: "server", route: "/api/cron/monitor", method: "GET", severity: "critical" });
    return Response.json({ ok: false, error: "Falha ao rodar o monitor." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
