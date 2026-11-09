import { cookies } from "next/headers";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";
import { hashToken } from "./passwords";

import {noServices,type DoctorServices} from "@/lib/doctor-services";
export type Role = "general_manager" | "secretary" | "doctor";
export const SESSION_COOKIE = "agenda_rn_session";

// A organização vem do vínculo ativo do usuário (um por usuário), nunca do navegador.
// O login exige vínculo ativo com o mesmo papel, em organização ativa.
// Devolve quantas organizações ativas a pessoa tem (até 2: basta saber se precisa escolher).
export async function activeMembershipCount(db: ReturnType<typeof getSupabaseAdmin>, userId: number, role: Role): Promise<number> {
  const memberships = await db.from("organization_memberships")
    .select("organization_id,organizations!inner(active)")
    .eq("user_id",userId).eq("active",true).eq("role",role).eq("organizations.active",true)
    .limit(2);
  dbError(memberships.error,"Read organization membership");
  return (memberships.data || []).length;
}
export async function hasActiveMembership(db: ReturnType<typeof getSupabaseAdmin>, userId: number, role: Role): Promise<boolean> {
  return (await activeMembershipCount(db, userId, role)) > 0;
}

export type Organization = { id: string; slug: string; name: string; kind?: string };
export type Customer = { id: string; name: string; isOwner: boolean; maxOrganizations: number; organizationCount: number };
export type Session = { account: { id: number; email: string; name: string; role: Role; doctorId: string|null }; organization: Organization; organizations: Organization[]; customer: Customer|null; services: DoctorServices; agendaIds: string[] };

// Hash do token do cookie, ou null quando ausente/malformado (sem consulta ao banco).
export async function sessionTokenHash(): Promise<string|null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[0-9a-f-]{73}$/.test(token)) return null;
  return hashToken(token);
}

// Normaliza o JSON de public.session_context (mesmas regras de hasActiveMembership).
export function sessionFromContext(raw: unknown): Session|null {
  const value = raw as { account?: Record<string, unknown>; organization?: Record<string, unknown>; organizations?: Array<Record<string, unknown>>; customer?: Record<string, unknown>; services?: DoctorServices; agendaIds?: unknown[] } | null;
  const account = value?.account, organization = value?.organization;
  if (!account || !["general_manager", "secretary", "doctor"].includes(String(account.role))) return null;
  if (!organization?.id) return null;
  const role = account.role as Role;
  return {
    account: { id: Number(account.id), email: String(account.email ?? ""), name: String(account.name ?? ""), role, doctorId: (account.doctorId as string|null) ?? null },
    organization: { id: String(organization.id), slug: String(organization.slug ?? ""), name: String(organization.name ?? ""), kind: organization.kind ? String(organization.kind) : undefined },
    organizations: (value?.organizations || []).map(o => ({ id: String(o.id), slug: String(o.slug ?? ""), name: String(o.name ?? ""), kind: o.kind ? String(o.kind) : undefined })),
    customer: value?.customer?.id ? { id: String(value.customer.id), name: String(value.customer.name ?? ""), isOwner: value.customer.isOwner === true, maxOrganizations: Number(value.customer.maxOrganizations ?? 0), organizationCount: Number(value.customer.organizationCount ?? 0) } : null,
    services: role === "doctor" ? { ...noServices, ...(value?.services || {}) } : { ...noServices },
    agendaIds: role === "general_manager" ? [] : [...new Set((value?.agendaIds || []).map(String))],
  };
}

// Uma única ida ao banco: sessão válida, usuário ativo, vínculo ativo na organização do usuário,
// serviços do médico e agendas liberadas (public.session_context).
export async function getSession(): Promise<Session|null> {
  const tokenHash = await sessionTokenHash();
  if (!tokenHash) return null;
  const { data, error } = await getSupabaseAdmin().rpc("session_context", { p_token_hash: tokenHash });
  dbError(error, "Read session");
  return sessionFromContext(data);
}

export function isManager(role: Role) { return role === "general_manager"; }
