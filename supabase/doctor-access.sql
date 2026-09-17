-- Professional identity is independent of authentication and agenda permissions.
alter table public.users add column if not exists doctor_id text references public.doctors(id);
create unique index if not exists users_doctor_identity_unique on public.users(doctor_id) where doctor_id is not null;
with matches as (
 select u.id,d.id doctor_id,count(*) over(partition by u.id) user_matches,count(*) over(partition by d.id) doctor_matches
 from public.users u join public.doctors d on lower(trim(regexp_replace(u.name,'^Dr[.]?[[:space:]]+','','i')))=lower(trim(regexp_replace(d.name,'^Dr[.]?[[:space:]]+','','i')))
 where u.role='doctor' and u.doctor_id is null and exists(select 1 from public.agenda_access a where a.user_id=u.id and a.professional_id=d.id)
)
update public.users u set doctor_id=m.doctor_id from matches m where u.id=m.id and m.user_matches=1 and m.doctor_matches=1 and not exists(select 1 from public.users x where x.doctor_id=m.doctor_id);
-- Unresolved legacy identities can remain until edited; new/changed accounts must be linked.
create or replace function public.validate_user_doctor_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if new.role<>'doctor' and new.doctor_id is not null then raise exception 'Somente usuário médico pode ter identidade profissional'; end if;
 if new.role='doctor' and new.doctor_id is null then
  if tg_op='INSERT' then raise exception 'Selecione o médico deste acesso'; end if;
  if old.role is distinct from new.role or old.doctor_id is distinct from new.doctor_id then raise exception 'Selecione o médico deste acesso'; end if;
 end if;
 return new;
end;$$;
drop trigger if exists user_doctor_identity on public.users;
create trigger user_doctor_identity before insert or update on public.users for each row execute function public.validate_user_doctor_identity();

create or replace function public.save_user_access(p_actor bigint,p_data jsonb,p_credentials jsonb default null) returns bigint language plpgsql security invoker set search_path='' as $$
declare uid bigint:=nullif(p_data->>'id','')::bigint; old_account public.users%rowtype; did text:=nullif(p_data->>'doctor_id',''); email_value text:=lower(trim(p_data->>'email')); role_value text:=p_data->>'role'; grant_id text;
begin
 perform pg_advisory_xact_lock(194701,1);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Acesso restrito à gerência'; end if;
 if role_value not in ('general_manager','secretary','doctor') or role_value is null or email_value is null or email_value !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or length(email_value)>254 then raise exception 'Dados de acesso inválidos'; end if;
 if role_value='doctor' and (did is null or not exists(select 1 from public.doctors where id=did)) then raise exception 'Selecione um médico existente'; end if;
 if role_value<>'doctor' then did:=null; end if;
 if uid=p_actor and role_value<>'general_manager' then raise exception 'Outro gerente deve alterar seu nível de acesso'; end if;
 if uid is not null then
  select * into old_account from public.users where id=uid for update;
  if not found then raise exception 'Usuário inexistente'; end if;
  if p_data ? 'updated_at' and old_account.updated_at is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Acesso alterado por outro usuário. Atualize'; end if;
 end if;
 if exists(select 1 from public.users where lower(email)=email_value and id is distinct from uid) then raise exception 'Já existe uma conta com este e-mail'; end if;
 if did is not null and exists(select 1 from public.users where doctor_id=did and id is distinct from uid) then raise exception 'Este médico já possui um acesso'; end if;
 if uid is null and p_credentials is null then raise exception 'Informe uma senha inicial'; end if;
 if p_credentials is not null and (coalesce(p_credentials->>'hash','') !~ '^pbkdf2-sha256\$600000\$[A-Za-z0-9+/=]+$' or length(coalesce(p_credentials->>'salt',''))<20) then raise exception 'Credencial inválida'; end if;
 if p_data ? 'agendaIds' then
  if jsonb_typeof(p_data->'agendaIds') is distinct from 'array' then raise exception 'Agendas inválidas'; end if;
  for grant_id in select jsonb_array_elements_text(p_data->'agendaIds') loop
   if not exists(select 1 from public.doctors where id=grant_id) then raise exception 'Agenda inexistente'; end if;
  end loop;
 end if;
 if uid is null then
  insert into public.users(email,name,role,doctor_id,password_hash,password_salt) values(email_value,coalesce(p_data->>'name',''),role_value,did,p_credentials->>'hash',p_credentials->>'salt') returning id into uid;
 else
  update public.users set email=email_value,name=coalesce(p_data->>'name',''),role=role_value,doctor_id=did,password_hash=coalesce(p_credentials->>'hash',password_hash),password_salt=coalesce(p_credentials->>'salt',password_salt),updated_at=clock_timestamp() where id=uid;
 end if;
 delete from public.sessions where user_id=uid;
 if p_data ? 'agendaIds' or role_value='general_manager' then
  delete from public.agenda_access where user_id=uid;
  if role_value<>'general_manager' then
   insert into public.agenda_access(user_id,professional_id) select uid,value from (select distinct jsonb_array_elements_text(p_data->'agendaIds') value) x;
  end if;
 end if;
 if did is not null and not exists(select 1 from public.agenda_access where user_id=uid and professional_id=did) then insert into public.agenda_access(user_id,professional_id) values(uid,did); end if;
 insert into public.directory_audit(actor_id,kind,record_id,before_data,after_data) values(p_actor,'user_access',uid::text,case when old_account.id is not null then jsonb_build_object('email',old_account.email,'role',old_account.role,'doctor_id',old_account.doctor_id) end,jsonb_build_object('email',email_value,'role',role_value,'doctor_id',did,'password_changed',p_credentials is not null,'agendaIds',(select coalesce(jsonb_agg(professional_id),'[]') from public.agenda_access where user_id=uid)));
 return uid;
end;$$;
create or replace function public.save_doctor_with_access(p_actor bigint,p_kind text,p_data jsonb,p_access jsonb default null,p_credentials jsonb default null) returns text language plpgsql security invoker set search_path='' as $$
declare did text; account_id bigint; access_data jsonb;
begin
 did:=public.save_doctor_directory(p_actor,p_kind,p_data);
 if p_access is not null then
  if p_kind<>'doctor' then raise exception 'Acesso pertence ao médico, não à agenda'; end if;
  select id into account_id from public.users where doctor_id=did;
  if (p_access->>'id')::bigint is distinct from account_id then raise exception 'Acesso alterado por outro usuário. Atualize'; end if;
  access_data:=p_access||jsonb_build_object('id',account_id,'doctor_id',did,'role','doctor','name',p_data->>'name');
  perform public.save_user_access(p_actor,access_data,p_credentials);
 end if;
 return did;
end;$$;
revoke all on function public.validate_user_doctor_identity() from public,anon,authenticated;
revoke all on function public.save_user_access(bigint,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.save_doctor_with_access(bigint,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_user_access(bigint,jsonb,jsonb),public.save_doctor_with_access(bigint,text,jsonb,jsonb,jsonb) to service_role;
