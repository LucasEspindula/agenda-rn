import { z } from "zod";
import { readJson, secureMutation } from "@/lib/security/http";
import { getSession, isManager, type Role } from "@/app/authz";
import { hashPassword } from "@/app/passwords";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";

async function managerSession() {
  const session = await getSession();
  return session?.account && isManager(session.account.role) ? session : null;
}

export async function GET() {
  if (!await managerSession()) return Response.json({ error: "Somente o Gerente geral pode gerenciar acessos" }, { status: 403 });
  const db = getSupabaseAdmin();
  const [accountsResult, grantsResult] = await Promise.all([db.from("users").select("id,email,name,role,created_at,updated_at").order("name").order("email"), db.from("agenda_access").select("user_id,professional_id")]);
  dbError(accountsResult.error, "Read users"); dbError(grantsResult.error, "Read grants");
  const accounts = (accountsResult.data || []) as Array<{ id: number; email: string; name: string; role: Role; created_at: string; updated_at: string }>;
  const grants = (grantsResult.data || []) as Array<{ user_id: number; professional_id: string }>;
  return Response.json({ users: accounts.map((account) => ({ ...account, agendaIds: grants.filter((grant) => Number(grant.user_id) === Number(account.id)).map((grant) => grant.professional_id) })) });
}

async function handlePOST(request: Request) {
  const session = await managerSession();
  if (!session) return Response.json({ error: "Somente o Gerente geral pode gerenciar acessos" }, { status: 403 });
  const parsed = z.object({ id:z.number().int().positive().optional(), email:z.string().trim().email().max(254), name:z.string().max(200).optional(), role:z.enum(["general_manager","secretary","doctor"]), agendaIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(500).optional(), password:z.string().min(12).max(128).optional() }).strict().safeParse(await readJson(request));
  if (!parsed.success) return Response.json({error:"Dados inválidos. Senhas novas precisam ter de 12 a 128 caracteres."},{status:400});
  const data = parsed.data;
  const email = data.email?.trim().toLowerCase();
  if (!email || !["general_manager", "secretary", "doctor"].includes(data.role ?? "")) return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const db = getSupabaseAdmin();
  if (!data.id && (!data.password || data.password.length < 8)) return Response.json({ error: "Informe uma senha inicial com pelo menos 8 caracteres" }, { status: 400 });
  if (data.id === session.account.id && data.role !== "general_manager") return Response.json({ error: "Para sua segurança, outro gerente deve alterar seu nível de acesso." }, { status: 400 });
  const agendas = await db.from("app_state").select("payload").eq("id",1).maybeSingle();
  dbError(agendas.error,"Read agenda identifiers");
  const validAgendas = new Set((agendas.data?.payload?.professionals || []).map((p: {id:string})=>p.id));
  if ((data.agendaIds || []).some(id=>!validAgendas.has(id))) return Response.json({error:"Agenda inexistente"},{status:400});
  const password = data.password ? await hashPassword(data.password) : null;
  let account;
  let accountId = data.id;
  if (!accountId) {
    const existing = await db.from("users").select("id").eq("email", email).maybeSingle();
    dbError(existing.error, "Find existing user");
    if (existing.data) return Response.json({error:"Já existe uma conta com este e-mail. Edite o acesso existente."},{status:409});
  }
  if (accountId === session.account.id && data.role !== "general_manager") return Response.json({ error: "Para sua segurança, outro gerente deve alterar seu nível de acesso." }, { status: 400 });
  if (accountId) { const result = await db.from("users").update({ email, name: data.name?.trim() ?? "", role: data.role!, updated_at: new Date().toISOString(), ...(password ? { password_hash: password.hash, password_salt: password.salt } : {}) }).eq("id", accountId).select("*").maybeSingle(); dbError(result.error, "Update user"); account = result.data; }
  else { const result = await db.from("users").insert({ email, name: data.name?.trim() ?? "", role: data.role!, password_hash: password!.hash, password_salt: password!.salt }).select("*").single(); dbError(result.error, "Create user"); account = result.data; }
  if (!account) return Response.json({ error: "Usuário não encontrado" }, { status: 404 });
  const revoked = await db.from("sessions").delete().eq("user_id",account.id); dbError(revoked.error,"Revoke sessions after access change");
  const removed = await db.from("agenda_access").delete().eq("user_id", account.id); dbError(removed.error, "Reset grants");
  const agendaIds = data.role === "general_manager" ? [] : [...new Set(data.agendaIds ?? [])];
  if (agendaIds.length) { const grants = await db.from("agenda_access").insert(agendaIds.map((professionalId) => ({ user_id: account.id, professional_id: professionalId }))); dbError(grants.error, "Create grants"); }
  return Response.json({ ok: true });
}

async function handleDELETE(request: Request) {
  const session = await managerSession();
  if (!session) return Response.json({ error: "Somente o Gerente geral pode gerenciar acessos" }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0 || id === session.account.id) return Response.json({ error: "O Gerente geral atual não pode remover o próprio acesso" }, { status: 400 });
  const result = await getSupabaseAdmin().from("users").delete().eq("id", id); dbError(result.error, "Delete user");
  return Response.json({ ok: true });
}


export const POST = secureMutation(handlePOST);
export const DELETE = secureMutation(handleDELETE);
