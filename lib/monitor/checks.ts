// Verificações do assistente. Cada uma olha uma parte do sistema e devolve "achados".
// Um achado pode trazer um conserto (repair): seguro, idempotente e sem tocar em dado de
// paciente. O executor (runner.ts) tenta o conserto, verifica de novo e só chama um dev se
// o problema continuar.
//
// Para ensinar algo novo ao assistente (ex.: lembretes da agenda), basta acrescentar um item
// em CHECKS com run() e, se der para resolver sozinho, repair().

import type { Severity } from "./alert";

export type Finding = {
  key: string;
  severity: Severity;
  title: string;
  diagnosis?: string;
  action?: string;
  repair?: () => Promise<string>;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CheckContext = { db: any; env: "production" | "preview" | "development"; now: Date; wait?: (ms: number) => Promise<void> };
export type Check = { id: string; label: string; run: (ctx: CheckContext) => Promise<Finding[]> };

const HOUR = 3600_000;

// ---- Regras puras (testadas em tests/monitoring.test.mjs) ----

export function evaluateDatabase(first: { ok: boolean; ms: number }, retry?: { ok: boolean; ms: number }): Finding[] {
  if (!first.ok && !(retry && retry.ok)) return [{ key: "down", severity: "critical", title: "Banco de dados não responde",
    diagnosis: "O servidor não consegue falar com o Supabase há pelo menos duas tentativas seguidas.",
    action: "Ver status.supabase.com e o painel do projeto no Supabase (projeto pausado? limite do plano?). Se o Supabase estiver normal, chamar um dev." }];
  const ms = retry && !first.ok ? retry.ms : first.ms;
  if (ms > 2500) return [{ key: "slow", severity: "warning", title: `Banco de dados lento (${Math.round(ms)} ms)`,
    diagnosis: "Respostas do banco acima de 2,5 s deixam a agenda lenta.",
    action: "Costuma passar sozinho. Se repetir por horas, ver Supabase → Reports → Database (consultas lentas, uso de CPU)." }];
  return [];
}

export function evaluateMaintenance(lastRun: Date | null, backlog: number, now: Date): "ok" | "overdue" {
  if (lastRun) return now.getTime() - lastRun.getTime() > 26 * HOUR ? "overdue" : "ok";
  return backlog > 0 ? "overdue" : "ok";
}

export function evaluateLoginFailures(count: number): Finding[] {
  if (count < 30) return [];
  return [{ key: "login-failures", severity: count >= 100 ? "error" : "warning", title: `${count} falhas de login na última hora`,
    diagnosis: "Muitas senhas erradas em pouco tempo: pode ser alguém tentando adivinhar senhas. O sistema já bloqueia cada origem após 5 tentativas.",
    action: "Nenhuma ação imediata. Se continuar, ver a tabela security_events (origens repetidas) e considerar bloquear o IP no firewall da Vercel." }];
}

export function evaluateEmail(env: string, configured: boolean, signupEnabled: boolean): Finding[] {
  if (env !== "production" || configured) return [];
  return [{ key: "not-configured", severity: signupEnabled ? "warning" : "info", title: "Envio de e-mail não configurado",
    diagnosis: "Sem e-mail, convites e “Esqueci minha senha” não funcionam.",
    action: "Configurar RESEND_API_KEY, EMAIL_FROM e APP_ORIGIN na Vercel." }];
}

export function evaluateAlertChannels(env: string, webhook: boolean, email: boolean): Finding[] {
  if (env !== "production" || webhook || email) return [];
  return [{ key: "no-channel", severity: "info", title: "Nenhum canal de aviso configurado",
    action: "Definir ALERT_WEBHOOK_URL (Discord/Slack) ou ALERT_EMAIL na Vercel. Até lá, só o e-mail do GitHub avisa em caso crítico." }];
}

// ---- Verificações ----

async function timed(fn: () => Promise<unknown>) {
  const t = Date.now();
  try { await fn(); return { ok: true, ms: Date.now() - t }; } catch { return { ok: false, ms: Date.now() - t }; }
}

export const CHECKS: Check[] = [
  {
    id: "database",
    label: "Banco de dados",
    async run({ db, wait }) {
      const ping = () => timed(async () => { const { error } = await db.rpc("health_check"); if (error) throw error; });
      const first = await ping();
      // Uma falha isolada pode ser só um piscar da rede: tenta de novo antes de alarmar.
      const retry = first.ok ? undefined : (await (wait ?? (ms => new Promise(r => setTimeout(r, ms))))(2000), await ping());
      return evaluateDatabase(first, retry);
    },
  },
  {
    id: "maintenance",
    label: "Manutenção diária",
    async run({ db, now }) {
      const { data } = await db.from("monitor_heartbeats").select("last_run_at").eq("name", "maintenance").maybeSingle();
      const lastRun = data?.last_run_at ? new Date(data.last_run_at) : null;
      const { count } = await db.from("sessions").select("*", { count: "exact", head: true }).lt("expires_at", new Date(now.getTime() - 24 * HOUR).toISOString());
      if (evaluateMaintenance(lastRun, count || 0, now) === "ok") return [];
      return [{ key: "overdue", severity: "warning", title: "Manutenção diária atrasada",
        diagnosis: "A limpeza de sessões vencidas e registros antigos não rodou nas últimas 26 horas.",
        action: "Corrigido sozinho quando possível. Se repetir, conferir o cron em Vercel → Settings → Cron Jobs e o CRON_SECRET.",
        async repair() {
          const { data: removed, error } = await db.rpc("run_maintenance");
          if (error) throw new Error(error.message);
          return `manutenção executada pelo monitor (${removed?.sessions ?? 0} sessões vencidas removidas)`;
        } }];
    },
  },
  {
    id: "login",
    label: "Tentativas de login",
    async run({ db, now }) {
      const { count, error } = await db.from("security_events").select("*", { count: "exact", head: true })
        .eq("kind", "login_failure").gte("created_at", new Date(now.getTime() - HOUR).toISOString());
      if (error) throw new Error(error.message);
      return evaluateLoginFailures(count || 0);
    },
  },
  {
    id: "email",
    label: "Envio de e-mail",
    async run({ env }) {
      return evaluateEmail(env, Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), process.env.PUBLIC_SIGNUP_ENABLED === "true");
    },
  },
  {
    id: "alerts",
    label: "Canais de aviso",
    async run({ env }) {
      return evaluateAlertChannels(env, Boolean(process.env.ALERT_WEBHOOK_URL), Boolean(process.env.ALERT_EMAIL));
    },
  },
];
