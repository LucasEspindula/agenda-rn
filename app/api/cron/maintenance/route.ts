import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { cronAuthError } from "@/lib/security/cron";
import { reportIncident } from "@/lib/monitor/report";

export const dynamic = "force-dynamic";

// Chamada diária pela Vercel (vercel.json → crons). Também registra o próprio batimento
// (monitor_heartbeats), para o monitor perceber se ela parar de rodar.
export async function GET(request: Request) {
  const denied = cronAuthError(request);
  if (denied) return denied;
  const { data, error } = await getSupabaseAdmin().rpc("run_maintenance");
  if (error) {
    await reportIncident({ source: "server", severity: "error", title: `Manutenção diária falhou: ${error.message}`, route: "GET /api/cron/maintenance" });
    return Response.json({ error: "Falha na manutenção." }, { status: 500 });
  }
  console.info("[maintenance]", JSON.stringify(data));
  return Response.json({ ok: true, removed: data }, { headers: { "Cache-Control": "no-store" } });
}
