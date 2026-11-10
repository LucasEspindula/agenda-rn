// Catálogo de erros conhecidos: para cada padrão, o diagnóstico em linguagem simples, o que
// fazer e se o sistema resolve sozinho. É a "memória" do assistente: cada incidente novo que
// um dev resolver vira uma entrada aqui, e da próxima vez ninguém precisa investigar.
//
// auto:
//   "transient"  — falha passageira (rede, banco reiniciando). O app já tenta de novo; o
//                  incidente se encerra sozinho quando para de repetir. Só avisa se insistir.
//   "reload"     — o navegador ficou com uma versão antiga do app após uma publicação. O
//                  próprio navegador recarrega a página uma vez (components/client-monitor.tsx).
//   "config"     — falta configuração. Não há como corrigir sozinho, mas a ação é objetiva
//                  e não exige programar.
//   null         — precisa de um dev.

export type Playbook = { id: string; match: RegExp; diagnosis: string; action: string; auto: "transient" | "reload" | "config" | null };

export const PLAYBOOKS: Playbook[] = [
  {
    id: "stale-bundle",
    match: /ChunkLoadError|Loading (?:CSS )?chunk \S+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i,
    diagnosis: "O navegador ainda estava com a versão anterior do sistema depois de uma publicação.",
    action: "Nenhuma: a página recarrega sozinha uma vez. Se repetir muito, verificar a publicação na Vercel.",
    auto: "reload",
  },
  {
    id: "db-network",
    match: /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|UND_ERR|network error|Connection terminated|timeout exceeded|503 Service Unavailable|upstream connect error/i,
    diagnosis: "Falha passageira de rede entre o servidor e o banco de dados.",
    action: "Nenhuma se parar sozinha. Se durar mais de 15 minutos, ver status.supabase.com e o painel do Supabase.",
    auto: "transient",
  },
  {
    id: "db-overload",
    match: /too many connections|remaining connection slots|statement timeout|canceling statement due to statement timeout/i,
    diagnosis: "O banco de dados ficou sobrecarregado (conexões ou consultas lentas).",
    action: "Costuma passar sozinho. Se repetir, abrir Supabase → Reports → Database e ver consultas lentas; considerar aumentar o plano.",
    auto: "transient",
  },
  {
    id: "supabase-config",
    match: /Supabase server configuration is incomplete|Supabase requires HTTPS|Invalid API key|JWT/i,
    diagnosis: "O servidor está sem a chave ou o endereço do banco de dados.",
    action: "Na Vercel → Settings → Environment Variables, conferir NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SECRET_KEY e publicar de novo.",
    auto: "config",
  },
  {
    id: "email-config",
    match: /Envio de e-mail ainda não configurado|Endereço da aplicação não configurado|Origem da aplicação não configurada/i,
    diagnosis: "Envio de e-mail ou endereço público do sistema não configurados.",
    action: "Configurar RESEND_API_KEY, EMAIL_FROM e APP_ORIGIN na Vercel (passo a passo em docs/runbook-incidentes.md).",
    auto: "config",
  },
  {
    id: "email-provider",
    match: /Não foi possível enviar o e-mail/i,
    diagnosis: "O provedor de e-mail (Resend) recusou ou não respondeu.",
    action: "Ver o painel do Resend (domínio verificado, limite do plano). Os usuários podem tentar de novo.",
    auto: "transient",
  },
  {
    id: "rate-limit-store",
    match: /Proteção de acesso indisponível|Autenticação temporariamente indisponível/i,
    diagnosis: "A proteção contra tentativas repetidas não conseguiu falar com o banco.",
    action: "Normalmente acompanha uma falha de banco; some junto com ela.",
    auto: "transient",
  },
];

export function findPlaybook(text: string): Playbook | null {
  return PLAYBOOKS.find(p => p.match.test(text)) || null;
}
