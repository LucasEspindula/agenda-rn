import { getSession } from "@/app/authz";
import { canUseAgenda } from "@/lib/doctor-services";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session?.account || !canUseAgenda(session)) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  const { data, error } = await getSupabaseAdmin().from("app_state").select("updated_at").eq("id", 1).maybeSingle();
  dbError(error, "Read agenda revision");
  return Response.json({ revision: data?.updated_at ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}
