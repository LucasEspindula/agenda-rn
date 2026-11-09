import { getSession, isManager } from "@/app/authz";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { consumeLimit } from "@/lib/security/rate-limit";
import { HttpError } from "@/lib/security/http";

export const dynamic = "force-dynamic";

// Pedido de acesso do titular (LGPD art. 18, II): arquivo com tudo o que o sistema guarda do paciente.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || !isManager(session.account.role)) throw new HttpError(403, "Somente a gerência exporta dados de pacientes.");
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new HttpError(400, "Paciente inválido.");
    await consumeLimit("patient-export", String(session.account.id), 60, 3600);
    const { data, error } = await getSupabaseAdmin().rpc("export_patient_data", { p_actor: session.account.id, p_org: session.organization.id, p_patient: id });
    if (error) throw new HttpError(error.code === "P0001" ? 404 : 500, error.code === "P0001" ? error.message : "Não foi possível exportar.");
    return new Response(JSON.stringify(data, null, 2), { headers: {
      "content-type": "application/json; charset=utf-8", "Cache-Control": "private, no-store",
      "content-disposition": `attachment; filename="paciente-${id}.json"`,
    } });
  } catch (error) {
    return Response.json({ error: error instanceof HttpError ? error.message : "Não foi possível exportar." }, { status: error instanceof HttpError ? error.status : 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
