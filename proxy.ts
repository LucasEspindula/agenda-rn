import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';

export function proxy(request: NextRequest) {
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
