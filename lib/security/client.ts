// Identificador do cliente para limites de tentativa (a Vercel controla este cabeçalho).
export function clientIp(request: Request) {
  return process.env.VERCEL === "1" ? request.headers.get("x-vercel-forwarded-for") || "unknown" : "local";
}
