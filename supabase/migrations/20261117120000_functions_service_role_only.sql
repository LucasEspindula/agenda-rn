-- Funções do esquema public executáveis só pelo servidor (service_role).
-- O Postgres dá EXECUTE a PUBLIC em toda função nova, e o Supabase soma anon e authenticated
-- pelos privilégios padrão. Nenhuma era perigosa (todas SECURITY INVOKER e sem acesso de anon
-- às tabelas), mas a regra do projeto é: função só para service_role.
-- Todas as 140 funções já têm GRANT explícito para service_role, então nada deixa de funcionar.

-- 1) Fecha as funções que existem hoje.
do $migration$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end
$migration$;

-- 2) Funções criadas daqui em diante já nascem fechadas (cada migração dá o GRANT a service_role).
--    O EXECUTE para PUBLIC é um padrão global do Postgres (não aceita "in schema");
--    anon e authenticated vêm do padrão do Supabase no esquema public.
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- 3) Confere: nenhuma função do esquema public executável por PUBLIC, anon ou authenticated.
do $check$
declare
  n int;
begin
  select count(*) into n
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.pronamespace = 'public'::regnamespace
    and p.prokind in ('f', 'p')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
    and a.privilege_type = 'EXECUTE'
    and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')));
  if n > 0 then
    raise exception 'Ainda há % permissões de EXECUTE abertas em funções do esquema public', n;
  end if;
end
$check$;
