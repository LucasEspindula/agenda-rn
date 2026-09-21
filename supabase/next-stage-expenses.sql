create function public.save_company_finance(p_actor bigint,p_kind text,p_data jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare sid uuid:=coalesce(nullif(p_data->>'id','')::uuid,gen_random_uuid());entity uuid:=(p_data->>'billing_entity_id')::uuid;old_row jsonb;associate uuid:=nullif(p_data->>'paid_by_associate_id','')::uuid;
begin
 perform pg_advisory_xact_lock(194701,2);
 if not exists(select 1 from public.users where id=p_actor and role='general_manager') then raise exception 'Acesso restrito à gerência';end if;
 perform public.financial_operation(p_actor,p_kind,sid::text);
 if p_kind='associate' then select to_jsonb(a) into old_row from public.company_associates a where id=sid;
 elsif p_kind='expense' then select to_jsonb(e) into old_row from public.company_expenses e where id=sid;
 else raise exception 'Operação inválida';end if;
 if old_row is not null and (old_row->>'updated_at')::timestamptz is distinct from (p_data->>'updated_at')::timestamptz then raise exception 'Registro alterado. Atualize';end if;
 if old_row is not null and old_row->>'billing_entity_id' is distinct from entity::text then raise exception 'A entidade histórica não pode ser alterada';end if;
 if not exists(select 1 from public.billing_entities where id=entity and (active or old_row is not null)) then raise exception 'Entidade inativa ou inexistente';end if;
 if p_kind='associate' then
  insert into public.company_associates(id,billing_entity_id,name,doctor_id,active) values(sid,entity,trim(p_data->>'name'),nullif(p_data->>'doctor_id',''),coalesce((p_data->>'active')::boolean,true))
  on conflict(id) do update set name=excluded.name,doctor_id=excluded.doctor_id,active=excluded.active;
 else
  if associate is not null and not exists(select 1 from public.company_associates where id=associate and billing_entity_id=entity and (active or old_row->>'paid_by_associate_id'=associate::text)) then raise exception 'Associado inválido para a empresa';end if;
  insert into public.company_expenses(id,billing_entity_id,description,category,supplier,competence_date,due_date,paid_at,amount,status,notes,paid_by_associate_id)
  values(sid,entity,trim(p_data->>'description'),coalesce(p_data->>'category',''),coalesce(p_data->>'supplier',''),(p_data->>'competence_date')::date,nullif(p_data->>'due_date','')::date,case when p_data->>'status'='PAGO' then nullif(p_data->>'paid_at','')::date end,(p_data->>'amount')::numeric,p_data->>'status',p_data->>'notes',case when p_data->>'status'='PAGO' then associate end)
  on conflict(id) do update set description=excluded.description,category=excluded.category,supplier=excluded.supplier,competence_date=excluded.competence_date,due_date=excluded.due_date,paid_at=excluded.paid_at,amount=excluded.amount,status=excluded.status,notes=excluded.notes,paid_by_associate_id=excluded.paid_by_associate_id;
 end if;
 perform set_config('rn.operation','',true);perform set_config('rn.actor','',true);return sid;
end;$$;

create function public.stamp_patient_authorship() returns trigger language plpgsql security invoker set search_path='' as $$
declare p jsonb;previous jsonb;result jsonb:='[]';actor bigint:=nullif(current_setting('rn.actor',true),'')::bigint;
begin
 for p in select value from jsonb_array_elements(coalesce(new.payload->'patients','[]')) loop
  previous:=null;
  if tg_op='UPDATE' then select value into previous from jsonb_array_elements(coalesce(old.payload->'patients','[]')) where value->>'id'=p->>'id';end if;
  if previous is null or (previous-'created_by'-'created_at'-'updated_by'-'updated_at') is distinct from (p-'created_by'-'created_at'-'updated_by'-'updated_at') then
   if actor is null then raise exception 'Cadastro de paciente exige autoria';end if;
   p:=p||jsonb_build_object('created_by',case when previous is null then to_jsonb(actor) else previous->'created_by' end,'created_at',case when previous is null then to_jsonb(clock_timestamp()) else previous->'created_at' end,'updated_by',actor,'updated_at',clock_timestamp());
  else p:=(p-'created_by'-'created_at'-'updated_by'-'updated_at')||(select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(previous) where key in('created_by','created_at','updated_by','updated_at'));
  end if;
  result:=result||jsonb_build_array(p);
 end loop;
 new.payload:=jsonb_set(new.payload,'{patients}',result);return new;
end;$$;
create trigger patient_authorship before insert or update of payload on public.app_state for each row execute function public.stamp_patient_authorship();
create trigger sync_attendances after insert or update of payload on public.app_state for each row execute function public.sync_financial_attendances();
do $$declare t text;f record;begin
 foreach t in array array['attendances','billing_records','invoices','invoice_billing_records','billing_entities','billing_doctor_entities','doctors','company_associates','company_expenses'] loop
  execute format('create trigger financial_stamp before insert or update on public.%I for each row execute function public.financial_stamp()',t);
  execute format('create trigger financial_log_change after insert or update or delete on public.%I for each row execute function public.financial_log_change()',t);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('financial_operation','financial_log_snapshot','financial_stamp','financial_log_change','immutable_financial_log','financial_attendance','attribute_financial_attendance','sync_financial_attendances','save_manual_attendance','save_company_finance','stamp_patient_authorship') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end;$$;
