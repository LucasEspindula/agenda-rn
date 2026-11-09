import { z } from "zod";
import { getSession, isManager, sessionTokenHash } from "@/app/authz";
import { readJson, secureMutation, HttpError } from "@/lib/security/http";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { recordSecurityEvent } from "@/lib/security/events";

export const dynamic = "force-dynamic";

// Organizações da pessoa (seletor no cabeçalho) e dados da conta contratante.
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  return Response.json({ organization: session.organization, organizations: session.organizations, customer: session.customer },
    { headers: { "Cache-Control": "private, no-store" } });
}

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("switch"), organizationId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("create"), name: z.string().trim().min(2).max(120), kind: z.enum(["MANAGEMENT_COMPANY", "CLINIC", "SOLO_DOCTOR"]) }).strict(),
]);

async function handlePOST(request: Request) {
  const session = await getSession();
  const tokenHash = await sessionTokenHash();
  if (!session || !tokenHash) throw new HttpError(403, "Acesso não autorizado");
  const parsed = body.safeParse(await readJson(request, 4096));
  if (!parsed.success) throw new HttpError(400, "Dados inválidos.");
  const db = getSupabaseAdmin();
  let target: string;
  if (parsed.data.action === "create") {
    // O banco confere: titular da conta, limite do plano, nome e tipo.
    if (!session.customer?.isOwner) throw new HttpError(403, "Somente o titular da conta cria organizações.");
    const created = await db.rpc("create_account_organization", { p_actor: session.account.id, p_org: session.organization.id, p_name: parsed.data.name, p_kind: parsed.data.kind });
    if (created.error) throw new HttpError(created.error.code === "P0001" ? 409 : 400, created.error.code === "P0001" ? created.error.message : "Não foi possível criar a organização.");
    target = String(created.data);
  } else {
    const wanted = parsed.data.organizationId;
    if (!session.organizations.some(o => o.id === wanted)) throw new HttpError(403, "Acesso à organização negado");
    target = wanted;
  }
  // A sessão passa a trabalhar na organização escolhida (vínculo conferido no banco).
  const switched = await db.rpc("switch_session_organization", { p_token_hash: tokenHash, p_org: target });
  if (switched.error) throw new HttpError(403, "Acesso à organização negado");
  await recordSecurityEvent("organization_switch", request, { organizationId: target, actorId: session.account.id, details: { from: session.organization.id } });
  return Response.json({ ok: true, organizationId: target });
}

export const POST = secureMutation(handlePOST);

const update = z.object({ name: z.string().trim().min(2).max(120), kind: z.enum(["MANAGEMENT_COMPANY", "CLINIC", "SOLO_DOCTOR"]) }).strict();

// Nome e tipo da organização ativa (gerência; o banco confere o vínculo).
async function handlePATCH(request: Request) {
  const session = await getSession();
  if (!session || !isManager(session.account.role)) throw new HttpError(403, "Somente a gerência edita a organização.");
  const parsed = update.safeParse(await readJson(request, 2048));
  if (!parsed.success) throw new HttpError(400, "Informe o nome (2 a 120 caracteres) e o tipo.");
  const result = await getSupabaseAdmin().rpc("update_organization", { p_actor: session.account.id, p_org: session.organization.id, p_name: parsed.data.name, p_kind: parsed.data.kind });
  if (result.error) throw new HttpError(result.error.code === "P0001" ? 409 : 500, result.error.code === "P0001" ? result.error.message : "Não foi possível salvar.");
  return Response.json({ ok: true, organization: result.data });
}
export const PATCH = secureMutation(handlePATCH);
