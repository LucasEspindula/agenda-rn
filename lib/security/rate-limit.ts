import 'server-only';
import { createHmac } from 'node:crypto';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { HttpError } from './http';

export async function consumeLimit(scope: string, identity: string, limit: number, seconds: number) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new HttpError(503, 'Autenticação temporariamente indisponível.');
  const key = createHmac('sha256',secret).update(`${scope}:${identity}`).digest('hex');
  const {data,error} = await getSupabaseAdmin().rpc('consume_security_limit',{p_key:key,p_limit:limit,p_seconds:seconds});
  if (error || typeof data !== 'boolean') throw new HttpError(503, 'Proteção de acesso indisponível. Tente mais tarde.');
  if (!data) throw new HttpError(429, 'Muitas tentativas. Aguarde antes de tentar novamente.');
}
