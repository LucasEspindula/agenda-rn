import type { Instrumentation } from "next";

// Erros não tratados em páginas e rotas do servidor vão para o monitoramento
// (os tratados por secureMutation são registrados lá mesmo).
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/monitor/report");
  await reportError(error, { source: "server", route: context.routePath || request.path, method: request.method });
};
