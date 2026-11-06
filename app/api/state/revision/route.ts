import { sessionFromContext, sessionTokenHash } from "@/app/authz";
import { canUseAgenda } from "@/lib/doctor-services";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Consultado por cada aba aberta da agenda: sessão + revisões em uma única RPC
// (public.agenda_sync_signal), com o mesmo escopo por papel da versão anterior.
export async function GET() {
  const tokenHash = await sessionTokenHash();
  const denied = () => Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  if (!tokenHash) return denied();
  const { data, error } = await getSupabaseAdmin().rpc("agenda_sync_signal", { p_token_hash: tokenHash });
  dbError(error, "Read synchronization revision");
  const session = sessionFromContext(data?.session);
  if (!session || !canUseAgenda(session)) return denied();
  const revision = data.revision ? new Date(data.revision).toISOString() : null;
  return Response.json({ revision, workflowRevision: data.workflowRevision ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}
