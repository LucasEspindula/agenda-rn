// O esqueleto do banco (backups/schema/rn-integra-schema.sql) precisa restaurar num Postgres vazio.
// Roda o arquivo no PGlite e confere as contagens do cabeçalho gerado por npm run db:schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const sql = readFileSync('backups/schema/rn-integra-schema.sql', 'utf8');
const header = sql.match(/^-- Conteúdo: (.+)$/m)?.[1] ?? '';
const expected = (label) => Number(header.match(new RegExp(`${label} (\\d+)`))?.[1]);

test('o esqueleto do banco restaura num Postgres vazio com todas as estruturas', async () => {
  const db = new PGlite();
  // O Supabase traz esses papéis e esquemas prontos; o PGlite não.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema extensions; create schema vault;`);
  // Extensões do Supabase (pgcrypto, vault…) não existem no PGlite; o esquema public não depende delas.
  await db.exec(sql.replace(/^create extension .*$/gm, ''));

  const one = async (q) => Number((await db.query(q)).rows[0].n);
  assert.equal(await one(`select count(*) n from pg_tables where schemaname='public'`), expected('tabelas'));
  assert.equal(await one(`select count(*) n from pg_proc where pronamespace='public'::regnamespace`), expected('funções'));
  assert.equal(await one(`select count(*) n from pg_trigger t join pg_class c on c.oid=t.tgrelid
    where c.relnamespace='public'::regnamespace and not t.tgisinternal`), expected('gatilhos'));
  assert.equal(await one(`select count(*) n from pg_constraint where connamespace='public'::regnamespace and contype in ('p','u','c','f','x','t')`), expected('restrições'));
  assert.equal(await one(`select count(*) n from pg_indexes where schemaname='public'`), expected('índices'));
  // Nenhuma tabela fica sem RLS nem exposta a anon/authenticated.
  assert.equal(await one(`select count(*) n from pg_tables where schemaname='public' and not rowsecurity`), 0);
  assert.equal(await one(`select count(*) n from information_schema.role_table_grants
    where table_schema='public' and grantee in ('anon','authenticated')`), 0);
  // Nenhuma função executável por PUBLIC, anon ou authenticated: só o servidor (service_role).
  assert.equal(await one(`select count(*) n from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.pronamespace='public'::regnamespace and p.prokind in ('f','p') and a.privilege_type='EXECUTE'
      and (a.grantee=0 or a.grantee in (select oid from pg_roles where rolname in ('anon','authenticated')))`), 0);
  await db.close();
});
