import "server-only";
import { emailConfigured, sendMail } from "@/lib/email";

// Canais de aviso, todos opcionais (variáveis na Vercel, só produção):
//   ALERT_WEBHOOK_URL — Discord, Slack ou similar (https). Recebe { content, text }.
//   ALERT_EMAIL       — e-mail de quem responde aos incidentes (usa o Resend já configurado).
// Sem nenhum canal, o aviso fica no log da Vercel; problemas críticos também fazem a
// verificação agendada no GitHub falhar, e o GitHub manda e-mail.
export type Severity = "info" | "warning" | "error" | "critical";
export type Alert = { severity: Severity; title: string; detail?: string | null; route?: string | null; occurrences?: number; resolved?: boolean; diagnosis?: string; action?: string; note?: string };

const label: Record<Severity, string> = { critical: "CRÍTICO", error: "ERRO", warning: "ATENÇÃO", info: "INFO" };

export function alertText(alert: Alert) {
  const head = alert.resolved ? `✅ Resolvido: ${alert.title}` : `🚨 [${label[alert.severity]}] ${alert.title}`;
  const lines = [head];
  if (!alert.resolved) {
    if (alert.route) lines.push(`Onde: ${alert.route}`);
    if (alert.occurrences && alert.occurrences > 1) lines.push(`Ocorrências: ${alert.occurrences}`);
    if (alert.detail) lines.push(alert.detail.split("\n").slice(0, 3).join("\n"));
    lines.push("Roteiro: docs/runbook-incidentes.md");
  }
  return lines.join("\n").slice(0, 1800);
}

export async function sendAlert(alert: Alert): Promise<string[]> {
  const text = alertText(alert), used: string[] = [];
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (webhook && webhook.startsWith("https://")) {
    try {
      const response = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text, text }), signal: AbortSignal.timeout(5000) });
      if (response.ok) used.push("webhook"); else console.error("[monitor:alert] webhook", response.status);
    } catch (error) { console.error("[monitor:alert] webhook", error instanceof Error ? error.message : error); }
  }
  const to = process.env.ALERT_EMAIL;
  if (to && emailConfigured()) {
    try {
      const subject = (alert.resolved ? "Resolvido: " : `[${label[alert.severity]}] `) + alert.title.slice(0, 120);
      await sendMail({ to, subject: `RN Integra · ${subject}`, text, html: `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${text.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!))}</pre>` });
      used.push("email");
    } catch (error) { console.error("[monitor:alert] email", error instanceof Error ? error.message : error); }
  }
  console.warn("[monitor:alert]", JSON.stringify({ severity: alert.severity, title: alert.title, resolved: !!alert.resolved, channels: used }));
  return used;
}
