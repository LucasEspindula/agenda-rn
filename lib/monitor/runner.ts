import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { sendAlert } from "./alert";
import { CHECKS, type Check, type CheckContext, type Finding } from "./checks";
import { environment, reportIncident } from "./report";

export type MonitorSummary = {
  ok: boolean;
  environment: string;
  counts: Record<"critical" | "error" | "warning" | "info", number>;
  findings: { check: string; severity: Finding["severity"]; title: string }[];
  repaired: { check: string; title: string; note: string }[];
  resolved: number;
};

// Uma rodada do assistente: verifica, tenta consertar o que for seguro, registra o que sobrou,
// encerra o que voltou ao normal e avisa só quando precisa de alguém.
export async function runMonitor(checks: Check[] = CHECKS): Promise<MonitorSummary> {
  const db = getSupabaseAdmin(), env = environment();
  const ctx: CheckContext = { db, env, now: new Date() };
  const production = env === "production";
  const summary: MonitorSummary = { ok: true, environment: env, counts: { critical: 0, error: 0, warning: 0, info: 0 }, findings: [], repaired: [], resolved: 0 };
  const active: string[] = [];

  const run = async (check: Check): Promise<Finding[]> => {
    try { return await check.run(ctx); }
    catch (error) {
      return [{ key: "failed", severity: "warning", title: `A verificação “${check.label}” não conseguiu rodar`,
        action: "Ver o log da Vercel (/api/cron/monitor). Se repetir, chamar um dev.",
        diagnosis: error instanceof Error ? error.message.slice(0, 200) : undefined }];
    }
  };

  for (const check of checks) {
    let findings = await run(check);
    // 1º: consertar sozinho o que tem conserto seguro, e conferir se funcionou.
    for (const finding of findings.filter(f => f.repair)) {
      try {
        const note = await finding.repair!();
        const after = await run(check);
        if (!after.some(f => f.key === finding.key)) {
          summary.repaired.push({ check: check.id, title: finding.title, note });
          await reportIncident({ source: "check", severity: "info", title: `${finding.title} — corrigido automaticamente`, detail: note,
            key: `check:${check.id}:${finding.key}:repaired`, autoFix: "repaired" });
          if (production) await sendAlert({ severity: "info", title: finding.title, resolved: true, note: `Corrigido automaticamente: ${note}. Nenhuma ação necessária.` });
        }
        findings = after;
      } catch (error) {
        finding.diagnosis = `${finding.diagnosis || ""} Conserto automático falhou: ${error instanceof Error ? error.message.slice(0, 160) : "erro"}.`.trim();
      }
    }
    // 2º: o que sobrou vira incidente (e aviso, se for hora).
    for (const finding of findings) {
      const key = `check:${check.id}:${finding.key}`;
      active.push(key);
      summary.counts[finding.severity]++;
      summary.findings.push({ check: check.id, severity: finding.severity, title: finding.title });
      await reportIncident({ source: "check", severity: finding.severity, title: finding.title, key, diagnosis: finding.diagnosis, action: finding.action });
    }
  }

  // 3º: encerrar o que voltou ao normal e avisar que voltou (só o que tinha gerado aviso).
  for (const [fn, args] of [["resolve_monitor_checks", { p_environment: env, p_active: active }], ["resolve_quiet_incidents", { p_environment: env }]] as const) {
    const { data, error } = await db.rpc(fn, args);
    if (error) { console.error("[monitor]", fn, error.message); continue; }
    const list = Array.isArray(data) ? data : [];
    summary.resolved += list.length;
    if (production) for (const item of list) await sendAlert({ severity: item.severity, title: item.title, resolved: true });
  }

  summary.ok = summary.counts.critical === 0;
  await db.rpc("touch_monitor_heartbeat", { p_name: "monitor", p_ok: summary.ok, p_details: { counts: summary.counts, repaired: summary.repaired.length } });
  return summary;
}
