import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendAlert, type Severity } from "./alert";
import { findPlaybook } from "./playbook";
import { fingerprint, groupingText, MAX_DETAIL, normalizeRoute, scrub, scrubStack } from "./scrub";

export type { Severity };
export type Incident = {
  source: "server" | "client" | "check";
  severity: Severity;
  title: string;
  detail?: string | null;
  route?: string | null;
  organizationId?: string | null;
  diagnosis?: string;
  action?: string;
  autoFix?: "transient" | "reload" | "config" | "repaired" | null;
  // Assinatura explícita (verificações). Sem ela, é calculada a partir de origem, rota e título.
  key?: string;
};

export function environment(): "production" | "preview" | "development" {
  const env = process.env.VERCEL_ENV;
  return env === "production" || env === "preview" ? env : "development";
}

// Registra um incidente e, se for hora, avisa. Nunca lança exceção nem passa de ~3 s:
// o monitoramento não pode derrubar a resposta ao usuário.
export async function reportIncident(incident: Incident): Promise<{ alerted: boolean } | null> {
  const title = scrub(incident.title), route = incident.route ? scrub(incident.route, 200) : null;
  const detail = incident.detail ? scrub(incident.detail, MAX_DETAIL) : null;
  const env = environment();
  // Erro conhecido? Leva junto o diagnóstico e o que fazer; falha passageira só avisa se insistir
  // e não é tratada como erro grave.
  const playbook = incident.source === "check" ? null : findPlaybook([title, detail || ""].join(" "));
  const autoFix = incident.autoFix ?? playbook?.auto ?? null;
  const severity: Severity = playbook && (playbook.auto === "transient" || playbook.auto === "reload") && incident.severity === "error" ? "warning" : incident.severity;
  console.error("[monitor]", JSON.stringify({ env, source: incident.source, severity, title, route, playbook: playbook?.id }));
  const work = (async () => {
    const key = incident.key || `${incident.source}:${await fingerprint(env, incident.source, route || "", groupingText(title))}`;
    const { data, error } = await getSupabaseAdmin().rpc("record_monitor_incident", {
      p_fingerprint: key, p_environment: env, p_source: incident.source, p_severity: severity,
      p_title: title || "Erro sem mensagem", p_detail: detail, p_route: route, p_org: incident.organizationId ?? null,
      p_playbook: playbook?.id ?? null, p_auto_fix: autoFix, p_min_occurrences: autoFix === "transient" || autoFix === "reload" ? 5 : 1,
    });
    if (error) throw new Error(error.message);
    // Previews e ambiente local gravam, mas não avisam: são testes.
    const alerted = Boolean(data?.alert) && env === "production";
    if (alerted) await sendAlert({ severity: data.severity || severity, title, detail, route, occurrences: data.occurrences,
      diagnosis: playbook?.diagnosis ?? incident.diagnosis, action: playbook?.action ?? incident.action });
    return { alerted };
  })();
  try {
    return await Promise.race([work, new Promise<null>(resolve => setTimeout(() => resolve(null), 3000))]);
  } catch (error) {
    console.error("[monitor] falha ao registrar", error instanceof Error ? scrub(error.message) : "erro");
    return null;
  }
}

export async function reportError(error: unknown, context: { source: "server" | "client"; route?: string | null; method?: string; organizationId?: string | null; severity?: Severity }) {
  // Erros do Supabase chegam como objetos simples ({ message, code }), não como Error.
  const like = error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string" ? error as { name?: string; message: string; stack?: string } : null;
  const err = like ? { name: like.name || "Error", message: like.message, stack: like.stack } : { name: "Error", message: typeof error === "string" ? error : "Erro desconhecido", stack: undefined };
  const path = context.route ? normalizeRoute(context.route) : "";
  const where = context.method ? `${context.method} ${path || "/"}` : path;
  return reportIncident({
    source: context.source,
    severity: context.severity || "error",
    title: `${err.name || "Error"}: ${err.message || "sem mensagem"}`,
    detail: scrubStack(err.stack) || null,
    route: where ? String(where) : null,
    organizationId: context.organizationId,
  });
}
