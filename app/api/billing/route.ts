import { secureMutation, readJson } from "@/lib/security/http";
import { canReadAppointment, type Row } from "@/lib/security/state";
import { NextResponse } from "next/server";
import { getSession } from "@/app/authz";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

async function permittedAppointments(session: NonNullable<Awaited<ReturnType<typeof getSession>>>) {
  const {data,error}=await getSupabaseAdmin().from("app_state").select("payload").eq("id",1).maybeSingle();
  if(error) throw new Error("Agenda indisponível");
  const state=data?.payload || {};
  return new Set<string>([...(state.appointments || []),...(state.cancelledAppointments || [])].filter((a: Row)=>canReadAppointment(session,a)).map((a: Row)=>String(a.id)));
}


export async function GET(request: Request) {
  const session = await getSession();
  if (!session || session.account.role === "doctor") return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const method = url.searchParams.get("method");
  let query = getSupabaseAdmin().from("billing_records").select("id,appointment_id,billing_entity_id,billing_method,payment_status,invoice_number,received_amount,paid_at,notes,updated_at,updated_by").order("updated_at", { ascending: false });
  if (status === "PENDENTE" || status === "PAGO") query = query.eq("payment_status", status);
  if (method === "PARTICULAR" || method === "CONVENIO") query = query.eq("billing_method", method);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Não foi possível consultar o faturamento." }, { status: 500 });
  const allowed = await permittedAppointments(session);
  return NextResponse.json({ records: (data || []).filter(row => allowed.has(row.appointment_id)) }, { headers: { "cache-control": "no-store" } });
}

async function updateBilling(request: Request) {
  const session = await getSession();
  if (!session || session.account.role === "doctor") return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  const body = await readJson(request) as Record<string, unknown> | null;
  const appointmentId = typeof body?.appointment_id === "string" ? body.appointment_id.trim() : "";
  const entityId = typeof body?.billing_entity_id === "string" ? body.billing_entity_id : "";
  const method = body?.billing_method;
  const status = body?.payment_status;
  if (!appointmentId || !entityId || !["PARTICULAR","CONVENIO"].includes(String(method)) || !["PENDENTE","PAGO"].includes(String(status))) {
    return NextResponse.json({ error: "Dados financeiros inválidos." }, { status: 400 });
  }
  const allowed = await permittedAppointments(session);
  if (!allowed.has(appointmentId)) return NextResponse.json({error:"Atendimento sem permissão."},{status:403});
  const amount = body?.received_amount === null || body?.received_amount === undefined || body?.received_amount === "" ? null : Number(body.received_amount);
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return NextResponse.json({ error: "Valor recebido inválido." }, { status: 400 });
  const payload = { appointment_id: appointmentId, billing_entity_id: entityId, billing_method: method, payment_status: status, invoice_number: typeof body?.invoice_number === "string" ? body.invoice_number.trim() || null : null, received_amount: method === "CONVENIO" ? null : amount, paid_at: typeof body?.paid_at === "string" && body.paid_at ? body.paid_at : null, notes: typeof body?.notes === "string" ? body.notes.trim() || null : null, updated_at: new Date().toISOString(), updated_by: session.account.id };
  const { data, error } = await getSupabaseAdmin().from("billing_records").upsert(payload, { onConflict: "appointment_id" }).select().single();
  if (error) return NextResponse.json({ error: "Não foi possível salvar o faturamento." }, { status: 500 });
  return NextResponse.json({ record: data });
}

export const PUT = secureMutation(updateBilling);
