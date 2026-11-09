import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Para monitor de disponibilidade (ex.: UptimeRobot): não expõe dados, só o estado.
export async function GET() {
  const started = Date.now();
  try {
    const { error } = await getSupabaseAdmin().rpc("health_check");
    if (error) throw error;
    return Response.json({ ok: true, db: "ok", ms: Date.now() - started, version: (process.env.VERCEL_GIT_COMMIT_SHA || "local").slice(0, 7) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false, db: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
