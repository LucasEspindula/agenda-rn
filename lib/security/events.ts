import "server-only";
import { createHash, createHmac } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { clientIp } from "./client";

export type SecurityEventKind = "login_success" | "login_failure" | "login_unverified" | "password_reset" | "invite_accepted" | "organization_switch";

// IP e e-mail nunca são gravados em claro: só um resumo (HMAC/SHA-256) para correlacionar tentativas.
export function hashIp(request: Request) {
  const secret = process.env.SUPABASE_SECRET_KEY || "local";
  return createHmac("sha256", secret).update("ip:" + clientIp(request)).digest("hex").slice(0, 32);
}
export function hashEmail(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

// Registro de auditoria de segurança. Falha ao registrar nunca interrompe o fluxo do usuário.
export async function recordSecurityEvent(kind: SecurityEventKind, request: Request, event: { organizationId?: string | null; actorId?: number | null; target?: string | null; details?: Record<string, unknown> } = {}) {
  try {
    const { error } = await getSupabaseAdmin().rpc("record_security_event", {
      p_org: event.organizationId ?? null, p_actor: event.actorId ?? null, p_kind: kind, p_target: event.target ?? null,
      p_details: event.details ?? {}, p_ip_hash: hashIp(request),
    });
    if (error) console.error("[security-event]", kind, error.message);
  } catch (error) { console.error("[security-event]", kind, error instanceof Error ? error.message : error); }
}
