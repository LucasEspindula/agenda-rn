import { getSession } from "@/app/authz";
import { readJson, secureMutation } from "@/lib/security/http";
import { consumeLimit } from "@/lib/security/rate-limit";
import { reportError } from "@/lib/monitor/report";

export const dynamic = "force-dynamic";

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

// Erros do navegador (components/client-monitor.tsx). Só de quem está logado, com limite por
// usuário; o texto é limpo de dados pessoais antes de gravar (lib/monitor/scrub.ts).
export const POST = secureMutation(async request => {
  const session = await getSession();
  if (!session) return new Response(null, { status: 204 });
  await consumeLimit("client-error", String(session.account.id), 30, 3600);
  const body = await readJson(request, 8 * 1024);
  const error = new Error(text(body.message, 500) || "Erro sem mensagem");
  error.name = text(body.name, 80).replace(/[^\w.$-]/g, "") || "Error";
  error.stack = `${error.name}: ${error.message}\n${text(body.stack, 2000).split("\n").slice(1).join("\n")}`;
  await reportError(error, { source: "client", route: text(body.page, 200) || "/", organizationId: session.organization.id });
  return new Response(null, { status: 204 });
});
