import "server-only";
import { timingSafeEqual } from "node:crypto";

// Rotinas agendadas (Vercel Cron e a verificação do GitHub) enviam "Authorization: Bearer $CRON_SECRET".
// Sem CRON_SECRET configurado nada roda (fail-closed).
export function cronAuthError(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "Rotina não configurada." }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") || ""), expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: "Não autorizado." }, { status: 401 });
  return null;
}
