// Etapa A1: a agenda é lançada primeiro; o faturamento fica desligado até ser
// reconstruído em branch própria. Menus somem e o servidor recusa as rotas.
export const BILLING_PAUSED = true;
export const BILLING_PAUSED_MESSAGE = 'Faturamento em reconstrução.';
const prefixes = ['/api/billing', '/api/reports/billing', '/api/reports/monthly-closing', '/api/financial-attachments', '/api/patient-finance', '/billing', '/appointment-finance'];
export function isBillingPath(pathname: string) {
  return prefixes.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
}
export function billingPausedResponse() {
  return Response.json({ error: BILLING_PAUSED_MESSAGE }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } });
}
