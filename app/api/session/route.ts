import { getSession } from "@/app/authz";

export async function GET() {
  const session = await getSession();
  if (!session?.account) return Response.json({ error: "Acesso não autorizado" }, { status: 403 });
  return Response.json({ user: { email: session.account.email, name: session.account.name || session.account.email, role: session.account.role, agendaIds: session.agendaIds, doctorId: session.account.doctorId, professionalId: session.account.doctorId } });
}
