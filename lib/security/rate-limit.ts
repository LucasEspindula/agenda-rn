import 'server-only';
import { createHmac } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { HttpError } from './http';

// Limites de senha errada por conta (contam só falhas: o login devolve a tentativa quando a senha está certa).
export const LOGIN_FAILURE_LIMITS = [
  { scope: 'login-account', limit: 10, seconds: 900 },        // 10 erros em 15 min: espera curta
  { scope: 'login-account-day', limit: 20, seconds: 86400 },  // 20 erros em 24 h: bloqueio de até 24 h
] as const;

function limitKey(scope: string, identity: string) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new HttpError(503, 'Autenticação temporariamente indisponível.');
  return createHmac('sha256',secret).update(`${scope}:${identity}`).digest('hex');
}

export async function consumeLimit(scope: string, identity: string, limit: number, seconds: number, message = 'Muitas tentativas. Aguarde antes de tentar novamente.') {
  const key = limitKey(scope, identity);
  const {data,error} = await getSupabaseAdmin().rpc('consume_security_limit',{p_key:key,p_limit:limit,p_seconds:seconds});
  if (error || typeof data !== 'boolean') throw new HttpError(503, 'Proteção de acesso indisponível. Tente mais tarde.');
  if (!data) throw new HttpError(429, message);
}

// Devolve uma tentativa reservada (ex.: a senha estava certa). Falhar aqui só deixa o contador mais alto.
export async function refundLimit(scope: string, identity: string) {
  const {error} = await getSupabaseAdmin().rpc('refund_security_limit',{p_key:limitKey(scope, identity)});
  if (error) console.error('[rate-limit] refund', scope, error.message);
}

// Zera um contador (ex.: a pessoa redefiniu a senha e não precisa esperar o bloqueio acabar).
export async function clearLimit(scope: string, identity: string) {
  const {error} = await getSupabaseAdmin().rpc('clear_security_limit',{p_key:limitKey(scope, identity)});
  if (error) console.error('[rate-limit] clear', scope, error.message);
}
