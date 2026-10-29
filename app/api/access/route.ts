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
  const organization = await db.from("organizations").select("id").eq("slug","rn-gestao").eq("active",true).single();
  dbError(organization.error,"Read organization");
  const membershipResult = await db.from("organization_memberships").select("user_id").eq("organization_id",organization.data.id);
  dbError(membershipResult.error,"Read organization members");
  const memberIds=(membershipResult.data||[]).map((m:{user_id:number})=>m.user_id);
  if (!memberIds.length) return Response.json({ users: [] });
  const [accountsResult, grantsResult] = await Promise.all([db.from("users").select("id,email,name,role,doctor_id,active,created_at,updated_at").in("id",memberIds).order("name").order("email"), db.from("agenda_access").select("user_id,professional_id").in("user_id",memberIds)]);
  dbError(accountsResult.error, "Read users"); dbError(grantsResult.error, "Read grants");
  const accounts = (accountsResult.data || []) as Array<{ id: number; email: string; name: string; role: Role; created_at: string; updated_at: string }>;
  const grants = (grantsResult.data || []) as Array<{ user_id: number; professional_id: string }>;
  return Response.json({ users: accounts.map((account) => ({ ...account, agendaIds: grants.filter((grant) => Number(grant.user_id) === Number(account.id)).map((grant) => grant.professional_id) })) });
}

async function handlePOST(request: Request) {
  const session = await managerSession();
  if (!session) return Response.json({ error: "Somente o Gerente geral pode gerenciar acessos" }, { status: 403 });
  const parsed = z.object({ id:z.number().int().positive().optional(), doctor_id:z.string().nullable().optional(), updated_at:z.string().optional(), email:z.string().trim().email().max(254), name:z.string().max(200).optional(), role:z.enum(["general_manager","secretary","doctor"]), active:z.boolean().optional(), agendaIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)).max(500).optional(), password:z.string().min(12).max(128).optional() }).strict().safeParse(await readJson(request));
  if (!parsed.success) return Response.json({error:"Dados inválidos. Senhas novas precisam ter de 12 a 128 caracteres."},{status:400});
  const data = parsed.data;
  const email = data.email?.trim().toLowerCase();
  if (!email || !["general_manager", "secretary", "doctor"].includes(data.role ?? "")) return Response.json({ error: "Dados inválidos" }, { status: 400 });
  const db = getSupabaseAdmin();
  if (!data.id && (!data.password || data.password.length < 8)) return Response.json({ error: "Informe uma senha inicial com pelo menos 8 caracteres" }, { status: 400 });
  if (data.id === session.account.id && data.role !== "general_manager") return Response.json({ error: "Para sua segurança, outro gerente deve alterar seu nível de acesso." }, { status: 400 });
  const agendas = await db.from("app_state").select("payload,organizations!inner(slug,active)").eq("organizations.slug","rn-gestao").eq("organizations.active",true).maybeSingle();
  dbError(agendas.error,"Read agenda identifiers");
  const validAgendas = new Set((agendas.data?.payload?.professionals || []).map((p: {id:string})=>p.id));
  if ((data.agendaIds || []).some(id=>!validAgendas.has(id))) return Response.json({error:"Agenda inexistente"},{status:400});
  const password = data.password ? await hashPassword(data.password) : null;
  const result=await db.rpc("save_user_access",{p_actor:session.account.id,p_data:{...data,email,password:undefined},p_credentials:password});
  if(result.error)return Response.json({error:result.error.code==="P0001"?result.error.message:"Não foi possível salvar o acesso."},{status:409});
  return Response.json({ ok: true });
}

async function handleDELETE(request: Request) {
  const session = await managerSession();
  if (!session) return Response.json({ error: "Somente o Gerente geral pode gerenciar acessos" }, { status: 403 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isSafeInteger(id) || id <= 0 || id === session.account.id) return Response.json({ error: "O Gerente geral atual não pode desativar o próprio acesso" }, { status: 400 });
  const result = await getSupabaseAdmin().rpc("deactivate_user_access",{p_actor:session.account.id,p_target:id});
  if (result.error) return Response.json({error:result.error.code==="P0001"?result.error.message:"Não foi possível desativar o acesso."},{status:409});
  return Response.json({ ok: true });
}


export const POST = secureMutation(handlePOST);
export const DELETE = secureMutation(handleDELETE);
