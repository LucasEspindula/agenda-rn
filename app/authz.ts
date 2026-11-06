import { cookies } from "next/headers";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";
import { hashToken } from "./passwords";

import {noServices,type DoctorServices} from "@/lib/doctor-services";
export type Role = "general_manager" | "secretary" | "doctor";
export const SESSION_COOKIE = "agenda_rn_session";

// Single-organization gate. Never trust a tenant or role sent by the browser.
// Multi-organization onboarding must remain disabled until every domain table is scoped.
export async function hasActiveRnGestaoMembership(db: ReturnType<typeof getSupabaseAdmin>, userId: number, role: Role): Promise<boolean> {
  const [membership,organizations]=await Promise.all([
    db.from("organization_memberships")
      .select("role,organizations!inner(slug,active)")
      .eq("user_id",userId).eq("active",true).eq("role",role)
      .eq("organizations.slug","rn-gestao").eq("organizations.active",true)
      .maybeSingle(),
    // Global clinical/financial tables are not tenant-scoped yet: block all access if
    // a second organization is ever created before the isolation migration.
    db.from("organizations").select("id",{head:true,count:"exact"})
  ]);
  dbError(membership.error,"Read organization membership");
  dbError(organizations.error,"Read organization count");
  return Boolean(membership.data) && organizations.count===1;
}

export type Session = { account: { id: number; email: string; name: string; role: Role; doctorId: string|null }; services: DoctorServices; agendaIds: string[] };

// Hash do token do cookie, ou null quando ausente/malformado (sem consulta ao banco).
export async function sessionTokenHash(): Promise<string|null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[0-9a-f-]{73}$/.test(token)) return null;
  return hashToken(token);
}

// Normaliza o JSON de public.session_context (mesmas regras de hasActiveRnGestaoMembership).
export function sessionFromContext(raw: unknown): Session|null {
  const value = raw as { account?: Record<string, unknown>; services?: DoctorServices; agendaIds?: unknown[] } | null;
  const account = value?.account;
  if (!account || !["general_manager", "secretary", "doctor"].includes(String(account.role))) return null;
  const role = account.role as Role;
  return {
    account: { id: Number(account.id), email: String(account.email ?? ""), name: String(account.name ?? ""), role, doctorId: (account.doctorId as string|null) ?? null },
    services: role === "doctor" ? { ...noServices, ...(value?.services || {}) } : { ...noServices },
    agendaIds: role === "general_manager" ? [] : [...new Set((value?.agendaIds || []).map(String))],
  };
}

// Uma única ida ao banco: sessão válida, usuário ativo, vínculo ativo na organização única,
// serviços do médico e agendas liberadas (public.session_context).
export async function getSession(): Promise<Session|null> {
  const tokenHash = await sessionTokenHash();
  if (!tokenHash) return null;
  const { data, error } = await getSupabaseAdmin().rpc("session_context", { p_token_hash: tokenHash });
  dbError(error, "Read session");
  return sessionFromContext(data);
}

export function isManager(role: Role) { return role === "general_manager"; }
