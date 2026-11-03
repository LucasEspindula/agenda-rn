import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { BILLING_PAUSED, BILLING_PAUSED_MESSAGE, billingPausedResponse, isBillingPath } from './lib/billing-paused';

export function proxy(request: NextRequest) {
  if (BILLING_PAUSED && isBillingPath(request.nextUrl.pathname)) {
    if (request.nextUrl.pathname.startsWith('/api/')) return billingPausedResponse();
    return new NextResponse(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RN Integra</title><body style="font-family:system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9;color:#1f2937"><main style="max-width:28rem;padding:1.5rem;text-align:center"><h1 style="font-size:1.25rem">${BILLING_PAUSED_MESSAGE}</h1><p>O módulo de faturamento está temporariamente indisponível enquanto é reconstruído. A agenda segue funcionando.</p><p><a href="/dashboard?agenda=1">Voltar para a agenda</a></p></main></body></html>`, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
  }
  const nonce = randomBytes(16).toString('base64');
  const dev = process.env.NODE_ENV !== 'production';
  const storage = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : '';
  const csp = ["default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:",
    `connect-src 'self' ${storage}${dev ? ' ws: wss:' : ''}`, "object-src 'none'", "base-uri 'none'", "form-action 'self'", request.nextUrl.pathname === '/appointment-finance' ? "frame-ancestors 'self'" : "frame-ancestors 'none'", ...(dev ? [] : ['upgrade-insecure-requests'])].join('; ');
  const headers = new Headers(request.headers);
  headers.set('x-nonce',nonce); headers.set('Content-Security-Policy',csp);
  const response = NextResponse.next({request:{headers}});
  response.headers.set('Content-Security-Policy',csp);
  if (request.nextUrl.pathname.startsWith('/api/') || request.nextUrl.pathname.startsWith('/dashboard')) response.headers.set('Cache-Control','private, no-store');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.svg|.*\\.(?:js|css|jpg|webp|svg)$).*)'] };
