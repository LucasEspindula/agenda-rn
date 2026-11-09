import { getSession, isManager } from "@/app/authz";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

// Equipe da organização ativa: membros e convites pendentes (somente gerência).
// ?setup=1 devolve só as contagens dos primeiros passos.
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !isManager(session.account.role)) return Response.json({ error: "Acesso restrito à gerência" }, { status: 403 });
  const setup = new URL(request.url).searchParams.get("setup") === "1";
  const { data, error } = await getSupabaseAdmin().rpc(setup ? "organization_setup_status" : "organization_team", { p_actor: session.account.id, p_org: session.organization.id });
  if (error) return Response.json({ error: error.code === "P0001" ? error.message : "Não foi possível carregar a equipe." }, { status: error.code === "P0001" ? 403 : 500 });
  return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
}
