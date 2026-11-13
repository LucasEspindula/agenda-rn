// Funções do esquema public só podem ser executadas pelo servidor (service_role).
// Recria o banco a partir do esqueleto, aplica a migração e confere as permissões.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = 'supabase/migrations/20261117120000_functions_service_role_only.sql';
const schema = readFileSync('backups/schema/rn-integra-schema.sql', 'utf8').replace(/^create extension .*$/gm, '');
const migration = readFileSync(MIGRATION, 'utf8');

const OPEN_EXECUTE = `
  select count(*)::int n
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
    and a.privilege_type = 'EXECUTE'
    and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated')))`;

async function restored() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema extensions; create schema vault;`);
  await db.exec(schema);
  return db;
}

test('a migração fecha todas as funções para PUBLIC, anon e authenticated, e o service_role continua executando', async () => {
  const db = await restored();
  await db.exec(migration);
  assert.equal((await db.query(OPEN_EXECUTE)).rows[0].n, 0);

  const semServidor = await db.query(`
    select count(*)::int n from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind in ('f','p')
      and not has_function_privilege('service_role', p.oid, 'EXECUTE')`);
  assert.equal(semServidor.rows[0].n, 0, 'toda função continua executável pelo service_role');

  await db.exec(`set role anon`);
  await assert.rejects(() => db.query(`select public.agenda_hhmi('10:30'::time)`), /permission denied/);
  await db.exec(`reset role`);
  await db.close();
});

test('funções criadas depois da migração já nascem fechadas', async () => {
  const db = await restored();
  await db.exec(migration);
  await db.exec(`create function public.nova_funcao_teste() returns int language sql set search_path = '' as 'select 1';`);
  const aberta = await db.query(`select has_function_privilege('anon', 'public.nova_funcao_teste()', 'EXECUTE') a,
    has_function_privilege('authenticated', 'public.nova_funcao_teste()', 'EXECUTE') b`);
  assert.deepEqual([aberta.rows[0].a, aberta.rows[0].b], [false, false]);
  await db.close();
});

test('a migração confere o resultado e falha se sobrar alguma função aberta', () => {
  assert.match(migration, /revoke execute on function %s from public, anon, authenticated/);
  assert.match(migration, /alter default privileges for role postgres\s+revoke execute on functions from public;/);
  assert.match(migration, /alter default privileges for role postgres in schema public\s+revoke execute on functions from anon, authenticated;/);
  assert.match(migration, /raise exception 'Ainda há % permissões de EXECUTE abertas/);
});
