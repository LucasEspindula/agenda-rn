import { cookies } from "next/headers";
import { dbError, getSupabaseAdmin } from "@/lib/supabase-admin";
import { hashToken } from "./passwords";

import {noServices,type DoctorServices} from "@/lib/doctor-services";
export type Role = "general_manager" | "secretary" | "doctor";
export const SESSION_COOKIE = "agenda_rn_session";

export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[0-9a-f-]{73}$/.test(token)) return null;
  const tokenHash = await hashToken(token);
  const db = getSupabaseAdmin();
  const { data: session, error } = await db.from("sessions").select("id,user_id,expires_at,users(id,email,name,role,doctor_id)").eq("token_hash", tokenHash).gt("expires_at", new Date().toISOString()).maybeSingle();
  dbError(error, "Read session");
  if (!session?.users) return null;
  const raw = Array.isArray(session.users) ? session.users[0] : session.users;
  if (!raw || !["general_manager", "secretary", "doctor"].includes(raw.role)) return null;
  const account = { id: Number(raw.id), email: raw.email as string, name: raw.name as string, role: raw.role as Role, doctorId: raw.doctor_id as string|null };
  let services:DoctorServices={...noServices};
  if(account.role==='doctor'&&account.doctorId){const result=await db.from('doctors').select('active,scheduling_enabled,billing_enabled,invoice_enabled').eq('id',account.doctorId).maybeSingle();dbError(result.error,'Read doctor services');if(result.data?.active)services={scheduling_enabled:result.data.scheduling_enabled,billing_enabled:result.data.billing_enabled,invoice_enabled:result.data.invoice_enabled};}
  if (account.role === "general_manager") return { account, services, agendaIds: [] as string[] };
  const { data: grants, error: grantError } = await db.from("agenda_access").select("professional_id").eq("user_id", account.id);
  dbError(grantError, "Read agenda grants");
  return { account, services, agendaIds: [...new Set([...((grants || []) as Array<{ professional_id: string }>).map((grant) => String(grant.professional_id)),...(account.role==='doctor'&&account.doctorId?[account.doctorId]:[])])] };
}

export function isManager(role: Role) { return role === "general_manager"; }
