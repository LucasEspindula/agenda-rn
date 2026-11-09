import { timingSafeEqual } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Chamada diária pela Vercel (vercel.json → crons). A Vercel envia "Authorization: Bearer $CRON_SECRET".
// Sem CRON_SECRET configurado a rota não roda (fail-closed).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "Manutenção não configurada." }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") || ""), expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: "Não autorizado." }, { status: 401 });
  const { data, error } = await getSupabaseAdmin().rpc("run_maintenance");
  if (error) { console.error("[maintenance]", error.message); return Response.json({ error: "Falha na manutenção." }, { status: 500 }); }
  console.info("[maintenance]", JSON.stringify(data));
  return Response.json({ ok: true, removed: data }, { headers: { "Cache-Control": "no-store" } });
}
