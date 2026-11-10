-- Monitoramento: base do futuro assistente da agenda.
-- 1. monitor_incidents: cada problema (erro do servidor, erro no navegador ou achado de uma
--    verificação) vira UM incidente aberto por assinatura (fingerprint); repetições só somam.
-- 2. monitor_heartbeats: última execução de cada rotina (manutenção, monitor), para saber
--    quando uma delas parou de rodar.
-- Nada aqui guarda dado de paciente: o servidor limpa e-mails, CPFs, números longos e tokens
-- antes de gravar (lib/monitor/scrub.ts).

create table if not exists public.monitor_incidents(
 id bigserial primary key,
 fingerprint text not null check (length(fingerprint) between 8 and 200),
 environment text not null default 'production' check (environment in ('production','preview','development')),
 source text not null check (source in ('server','client','check')),
 severity text not null check (severity in ('info','warning','error','critical')),
 title text not null check (length(title) <= 300),
 detail text check (length(detail) <= 2000),
 route text check (length(route) <= 200),
 playbook text check (length(playbook) <= 40),       -- erro conhecido (lib/monitor/playbook.ts)
 auto_fix text check (auto_fix in ('transient','reload','config','repaired')),
 organization_id uuid references public.organizations(id) on delete set null,
 occurrences integer not null default 1,
 first_seen timestamptz not null default now(),
 last_seen timestamptz not null default now(),
 alerted_at timestamptz,
 resolved_at timestamptz
);
create unique index if not exists monitor_incidents_open_uq on public.monitor_incidents(fingerprint) where resolved_at is null;
create index if not exists monitor_incidents_last_seen_idx on public.monitor_incidents(last_seen desc);
alter table public.monitor_incidents enable row level security;
revoke all on public.monitor_incidents from public,anon,authenticated;
grant select,insert,update,delete on public.monitor_incidents to service_role;
grant usage,select on sequence public.monitor_incidents_id_seq to service_role;

create table if not exists public.monitor_heartbeats(
 name text primary key check (name ~ '^[a-z][a-z0-9_-]{1,40}$'),
 last_run_at timestamptz not null default now(),
 ok boolean not null,
 details jsonb not null default '{}'::jsonb
);
alter table public.monitor_heartbeats enable row level security;
revoke all on public.monitor_heartbeats from public,anon,authenticated;
grant select,insert,update,delete on public.monitor_heartbeats to service_role;

create or replace function public.monitor_severity_rank(p text) returns integer
language sql immutable set search_path='' as $$
 select case p when 'critical' then 4 when 'error' then 3 when 'warning' then 2 else 1 end
$$;

-- Registra (ou soma) um incidente e decide, na mesma transação, se é hora de avisar:
-- crítico no máximo 1x/hora, erro 1x a cada 6 h, aviso 1x por dia, informação nunca.
-- p_min_occurrences: falhas passageiras só avisam se insistirem (ex.: 5 vezes).
create or replace function public.record_monitor_incident(p_fingerprint text,p_environment text,p_source text,p_severity text,
  p_title text,p_detail text,p_route text,p_org uuid,p_playbook text default null,p_auto_fix text default null,
  p_min_occurrences integer default 1) returns jsonb
language plpgsql set search_path='' as $$
declare inc public.monitor_incidents; throttle interval; alert boolean:=false; previous text;
begin
 select severity into previous from public.monitor_incidents where fingerprint=left(p_fingerprint,200) and resolved_at is null;
 insert into public.monitor_incidents(fingerprint,environment,source,severity,title,detail,route,organization_id,playbook,auto_fix)
 values(left(p_fingerprint,200),p_environment,p_source,p_severity,left(p_title,300),left(p_detail,2000),left(p_route,200),p_org,left(p_playbook,40),p_auto_fix)
 on conflict (fingerprint) where resolved_at is null do update set
   occurrences=public.monitor_incidents.occurrences+1,
   last_seen=now(),
   severity=case when public.monitor_severity_rank(excluded.severity)>public.monitor_severity_rank(public.monitor_incidents.severity)
                 then excluded.severity else public.monitor_incidents.severity end,
   title=excluded.title,
   detail=coalesce(excluded.detail,public.monitor_incidents.detail),
   playbook=coalesce(excluded.playbook,public.monitor_incidents.playbook),
   auto_fix=excluded.auto_fix
 returning * into inc;
 throttle:=case inc.severity when 'critical' then interval '1 hour' when 'error' then interval '6 hours' when 'warning' then interval '24 hours' end;
 -- Piorou (ex.: de aviso para crítico)? Avisa na hora, sem esperar o intervalo.
 if throttle is not null and inc.occurrences>=greatest(coalesce(p_min_occurrences,1),1) and (inc.alerted_at is null or inc.alerted_at<now()-throttle
     or public.monitor_severity_rank(inc.severity)>public.monitor_severity_rank(coalesce(previous,inc.severity))) then
   update public.monitor_incidents set alerted_at=now() where id=inc.id;
   alert:=true;
 end if;
 return jsonb_build_object('id',inc.id,'occurrences',inc.occurrences,'severity',inc.severity,'alert',alert,'new',inc.occurrences=1);
end;$$;

-- Verificações: o que não apareceu na rodada atual está resolvido. Devolve os resolvidos
-- que já tinham gerado aviso, para avisar também que voltou ao normal.
create or replace function public.resolve_monitor_checks(p_environment text,p_active text[]) returns jsonb
language sql set search_path='' as $$
 with done as (
   update public.monitor_incidents set resolved_at=now()
   where source='check' and environment=p_environment and resolved_at is null
     and not (fingerprint = any(coalesce(p_active,'{}'::text[])))
   returning title,severity,alerted_at
 )
 select coalesce(jsonb_agg(jsonb_build_object('title',title,'severity',severity)) filter (where alerted_at is not null),'[]'::jsonb) from done
$$;

-- Falhas passageiras e de versão antiga do navegador: 1 hora sem repetir = resolvidas sozinhas.
create or replace function public.resolve_quiet_incidents(p_environment text) returns jsonb
language sql set search_path='' as $$
 with done as (
   update public.monitor_incidents set resolved_at=now()
   where environment=p_environment and resolved_at is null and source in ('server','client')
     and auto_fix in ('transient','reload') and last_seen<now()-interval '1 hour'
   returning title,severity,alerted_at
 )
 select coalesce(jsonb_agg(jsonb_build_object('title',title,'severity',severity)) filter (where alerted_at is not null),'[]'::jsonb) from done
$$;

create or replace function public.touch_monitor_heartbeat(p_name text,p_ok boolean,p_details jsonb) returns void
language sql set search_path='' as $$
 insert into public.monitor_heartbeats(name,last_run_at,ok,details) values(p_name,now(),p_ok,coalesce(p_details,'{}'::jsonb))
 on conflict (name) do update set last_run_at=now(),ok=excluded.ok,details=excluded.details
$$;

-- Manutenção diária: também encerra erros que pararam de acontecer (7 dias sem repetir),
-- apaga incidentes resolvidos há mais de 90 dias e registra o próprio batimento.
create or replace function public.run_maintenance() returns jsonb
language plpgsql set search_path='' as $$
declare s integer; t integer; r integer; e integer; mr integer; md integer; result jsonb;
begin
 delete from public.sessions where expires_at<now()-interval '1 day'; get diagnostics s=row_count;
 delete from public.auth_tokens where expires_at<now()-interval '30 days'; get diagnostics t=row_count;
 delete from public.security_rate_limits where expires_at<now(); get diagnostics r=row_count;
 perform set_config('rn.maintenance','on',true);
 delete from public.security_events where created_at<now()-interval '365 days'; get diagnostics e=row_count;
 perform set_config('rn.maintenance','',true);
 update public.monitor_incidents set resolved_at=now()
  where resolved_at is null and source in ('server','client') and last_seen<now()-interval '7 days'; get diagnostics mr=row_count;
 delete from public.monitor_incidents where resolved_at<now()-interval '90 days'; get diagnostics md=row_count;
 result:=jsonb_build_object('sessions',s,'tokens',t,'rateLimits',r,'securityEvents',e,'incidentsResolved',mr,'incidentsDeleted',md);
 perform public.touch_monitor_heartbeat('maintenance',true,result);
 return result;
end;$$;

revoke all on function public.monitor_severity_rank(text),public.record_monitor_incident(text,text,text,text,text,text,text,uuid,text,text,integer),
 public.resolve_monitor_checks(text,text[]),public.resolve_quiet_incidents(text),public.touch_monitor_heartbeat(text,boolean,jsonb),public.run_maintenance() from public,anon,authenticated;
grant execute on function public.monitor_severity_rank(text),public.record_monitor_incident(text,text,text,text,text,text,text,uuid,text,text,integer),
 public.resolve_monitor_checks(text,text[]),public.resolve_quiet_incidents(text),public.touch_monitor_heartbeat(text,boolean,jsonb),public.run_maintenance() to service_role;
