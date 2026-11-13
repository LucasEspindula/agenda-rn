// Bloqueio de login por senha errada e regra única para senhas novas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { loadTs } from './load-ts.mjs';

const MIGRATION = 'supabase/migrations/20261118120000_login_failure_lockout.sql';
const read = (p) => readFileSync(p, 'utf8');

async function restored() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema extensions; create schema vault;`);
  await db.exec(read('backups/schema/rn-integra-schema.sql').replace(/^create extension .*$/gm, ''));
  await db.exec(read(MIGRATION));
  return db;
}

test('banco: tentativa devolvida não conta, e zerar libera na hora', async () => {
  const db = await restored();
  const key = 'a'.repeat(64);
  const consume = async () => (await db.query(`select public.consume_security_limit($1,3,900) ok`, [key])).rows[0].ok;
  const hits = async () => Number((await db.query(`select coalesce(sum(hits),0) n from public.security_rate_limits where key=$1`, [key])).rows[0].n);

  assert.equal(await consume(), true); assert.equal(await consume(), true);
  await db.query(`select public.refund_security_limit($1)`, [key]);
  await db.query(`select public.refund_security_limit($1)`, [key]);
  await db.query(`select public.refund_security_limit($1)`, [key]); // nunca fica negativo
  assert.equal(await hits(), 0);
  assert.deepEqual([await consume(), await consume(), await consume(), await consume()], [true, true, true, false]);
  await db.query(`select public.clear_security_limit($1)`, [key]);
  assert.equal(await hits(), 0);
  assert.equal(await consume(), true);

  for (const fn of ['refund_security_limit', 'clear_security_limit']) {
    const r = await db.query(`select has_function_privilege('anon','public.${fn}(text)','EXECUTE') a,
      has_function_privilege('authenticated','public.${fn}(text)','EXECUTE') b,
      has_function_privilege('service_role','public.${fn}(text)','EXECUTE') s`);
    assert.deepEqual([r.rows[0].a, r.rows[0].b, r.rows[0].s], [false, false, true], fn);
  }
  await db.close();
});

function loginApi({ passwordOk }) {
  const calls = [];
  const account = { id: 7, role: 'secretary', active: true, password_hash: 'pbkdf2-sha256$600000$x', password_salt: 's', email_verified_at: '2026-11-01' };
  const q = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: account, error: null }), insert: async () => ({ error: null }), update() { return this; } };
  const limits = loadTs('lib/security/rate-limit.ts', { '@/lib/supabase-admin': { getSupabaseAdmin: () => ({}) } });
  const api = loadTs('app/api/auth/login/route.ts', {
    'next/headers': { cookies: async () => ({ set() { calls.push(['cookie']); } }) },
    '@/app/authz': { SESSION_COOKIE: 'agenda_rn_session', activeMembershipCount: async () => 1 },
    '@/app/passwords': { hashPassword: async () => ({}), hashToken: async () => 'h', verifyPassword: async () => passwordOk },
    '@/lib/supabase-admin': { getSupabaseAdmin: () => ({ from: () => q, rpc: async () => ({ error: null }) }), dbError() {} },
    '@/lib/security/rate-limit': {
      LOGIN_FAILURE_LIMITS: limits.LOGIN_FAILURE_LIMITS,
      consumeLimit: async (scope, id) => { calls.push(['consume', scope, id]); },
      refundLimit: async (scope, id) => { calls.push(['refund', scope, id]); },
    },
    '@/lib/security/events': { hashEmail: () => 'x', recordSecurityEvent: async (kind) => { calls.push(['event', kind]); } },
  });
  const post = () => api.POST(new Request('https://example.com/api/auth/login', { method: 'POST',
    headers: { origin: 'https://example.com', 'content-type': 'application/json' },
    body: JSON.stringify({ email: ' Secretaria@Clinica.test ', password: 'uma-senha-qualquer' }) }));
  return { calls, post };
}

test('login: reserva a tentativa antes de conferir a senha e só devolve quando ela está certa', async () => {
  const wrong = loginApi({ passwordOk: false });
  assert.equal((await wrong.post()).status, 401);
  const reserved = wrong.calls.filter((c) => c[0] === 'consume').map((c) => c[1]);
  assert.deepEqual(reserved, ['login-failures-global', 'login-account', 'login-account-day']);
  assert.ok(wrong.calls.filter((c) => c[0] === 'consume' && c[1].startsWith('login-account')).every((c) => c[2] === 'secretaria@clinica.test'));
  assert.equal(wrong.calls.filter((c) => c[0] === 'refund').length, 0, 'senha errada não é devolvida');

  const right = loginApi({ passwordOk: true });
  assert.equal((await right.post()).status, 200);
  assert.deepEqual(right.calls.filter((c) => c[0] === 'refund').map((c) => c[1]).sort(), ['login-account', 'login-account-day', 'login-failures-global']);
  const firstRefund = right.calls.findIndex((c) => c[0] === 'refund'), lastConsume = right.calls.map((c) => c[0]).lastIndexOf('consume');
  assert.ok(lastConsume < firstRefund, 'a reserva acontece antes da devolução');
});

test('login: limites por conta de 10 erros em 15 min e 20 em 24 h, e redefinir a senha libera', () => {
  const { LOGIN_FAILURE_LIMITS } = loadTs('lib/security/rate-limit.ts', { '@/lib/supabase-admin': { getSupabaseAdmin: () => ({}) } });
  assert.equal(JSON.stringify(LOGIN_FAILURE_LIMITS.map((l) => [l.scope, l.limit, l.seconds])), JSON.stringify([['login-account', 10, 900], ['login-account-day', 20, 86400]]));
  const login = read('app/api/auth/login/route.ts');
  assert.match(login, /consumeLimit\("login-failures-global", "all", 600, 60\)/);
  assert.doesNotMatch(login, /login-global"/, 'o limite geral antigo contava também os logins certos');
  const reset = read('app/api/auth/reset/route.ts');
  assert.match(reset, /LOGIN_FAILURE_LIMITS\.map\(\(\{ scope \}\) => clearLimit\(scope, email\)\)/);
});

test('senha nova: mínimo de 12 e recusa de senhas comuns', () => {
  const { passwordProblem } = loadTs('lib/security/password-policy.ts');
  for (const weak of ['curta', '123456789012', 'aaaaaaaaaaaa', 'Senha@2026!!', 'senhasenha12', 'clinica12345', 'Qwerty123456', 'Ab1234567890!', 'Flamengo1981!', 'Médico2026!!!'])
    assert.ok(passwordProblem(weak), weak);
  assert.match(passwordProblem('marianasilva#77', 'mariana.silva@clinica.test') || '', /e-mail/);
  for (const ok of ['Tr0ub4dor&3xk', 'cavalo correto bateria grampo', 'Ipê-amarelo-floresce-em-agosto'])
    assert.equal(passwordProblem(ok, 'secretaria@clinica.test'), null, ok);
  assert.ok(passwordProblem('x'.repeat(129) + 'abc'));
});

test('toda criação ou troca de senha passa pela mesma regra', () => {
  for (const p of ['app/api/auth/signup/route.ts', 'app/api/auth/reset/route.ts', 'app/api/invites/accept/route.ts', 'app/api/access/route.ts', 'app/api/doctors/route.ts'])
    assert.match(read(p), /passwordProblem\(/, p);
  assert.doesNotMatch(read('app/api/access/route.ts'), /pelo menos 8 caracteres/);
});
