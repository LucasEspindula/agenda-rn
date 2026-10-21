-- Edicao auditada, in-place, de dados do tomador de uma solicitacao PENDENTE.
-- Status/identidade/snapshots financeiros e vinculo ao pagamento sao imutaveis.
create or replace function public.protect_invoice_request()
returns trigger language plpgsql set search_path=''
as $function$
declare kind text:=current_setting('rn.kind',true);
begin
 if tg_op='DELETE' then raise exception 'Preserve o histórico da solicitação fiscal';end if;
 if kind='edit_invoice_request' then
  if old.status<>'PENDING' or new.status<>'PENDING'
     or old.invoice_id is not null or new.invoice_id is not null then
    raise exception 'Somente solicitações pendentes e sem NF emitida podem ser corrigidas';
  end if;
  if (to_jsonb(new)-array['taker_kind','taker_name','taker_tax_id','taker_address','notes','updated_at','updated_by'])
     is distinct from (to_jsonb(old)-array['taker_kind','taker_name','taker_tax_id','taker_address','notes','updated_at','updated_by']) then
    raise exception 'A correção não pode alterar pagamento, paciente, médico ou vínculo fiscal';
  end if;
  return new;
 end if;
 if (to_jsonb(new)-array['status','invoice_id','updated_at','updated_by'])
     is distinct from (to_jsonb(old)-array['status','invoice_id','updated_at','updated_by']) then
  raise exception 'Snapshot fiscal imutável';
 end if;
 if old.status='PENDING' and new.status in ('PENDING','ISSUED','CANCELLED') then return new;end if;
 if old.status='ISSUED' and new.status='PENDING' and new.invoice_id is null
    and kind in ('undo_invoice','cancel_invoice','replace_invoice')
    and exists(select 1 from public.users where id=nullif(current_setting('rn.actor',true),'')::bigint
      and role='general_manager') then return new;end if;
 raise exception 'Transição fiscal não autorizada';
end;$function$;

create or replace function public.update_pending_invoice_request(p_actor bigint,p_data jsonb)
returns uuid language plpgsql set search_path=''
as $function$
declare request_row public.invoice_requests%rowtype;
        actor_role text; kind text; name text; cpf text; address_value text; note_value text;
        patient jsonb; expected timestamptz; linked public.billing_records%rowtype;
begin
 perform pg_advisory_xact_lock(194701,1);
 perform pg_advisory_xact_lock(194701,2);
 select role into actor_role from public.users where id=p_actor;
 if actor_role not in ('general_manager','secretary') then raise exception 'Sem permissão para corrigir solicitações fiscais';end if;
 if nullif(p_data->>'id','') is null or nullif(p_data->>'updated_at','') is null then raise exception 'Solicitação e versão obrigatórias';end if;
 select * into request_row from public.invoice_requests where id=(p_data->>'id')::uuid for update;
 if request_row.id is null then raise exception 'Solicitação fiscal não encontrada';end if;
 if request_row.status<>'PENDING' or request_row.invoice_id is not null then
  raise exception 'A NF já foi emitida ou a solicitação não está pendente. Faça a correção fiscal na NF';
 end if;
 expected:=(p_data->>'updated_at')::timestamptz;
 if request_row.updated_at is distinct from expected then raise exception 'Solicitação alterada por outra pessoa. Atualize antes de editar';end if;
 select * into linked from public.billing_records where id=request_row.billing_record_id for update;
 if linked.id is null or linked.payment_status<>'PAGO' or linked.billing_method<>'PARTICULAR'
    or linked.attendance_id<>request_row.attendance_id
    or linked.billing_entity_id<>request_row.billing_entity_id
    or linked.received_amount is distinct from request_row.received_amount_snapshot
    or linked.paid_at is distinct from request_row.paid_at_snapshot then
   raise exception 'Pagamento e solicitação fiscal precisam ser regularizados antes da alteração';
 end if;
 if actor_role='secretary' and not exists (
  select 1 from public.app_state s
  cross join lateral jsonb_array_elements(coalesce(s.payload->'appointments','[]'::jsonb)) appointment
  join public.agenda_access access on access.user_id=p_actor
   and access.professional_id in (appointment->>'doctorId',appointment->>'anesthetistId')
  where s.id=1 and appointment->>'id'=linked.appointment_id
 ) then raise exception 'Acesso negado à agenda desta solicitação';end if;
 kind:=p_data->>'taker_kind';
 if kind not in ('PATIENT','OTHER') then raise exception 'Selecione Próprio paciente ou Outra pessoa';end if;
 cpf:=regexp_replace(coalesce(p_data->>'taker_tax_id',''),'[^0-9]','','g');
 if not public.valid_cpf(cpf) then raise exception 'Informe um CPF válido';end if;
 name:=trim(coalesce(p_data->>'taker_name',''));
 if kind='PATIENT' then
  select p into patient from public.app_state s
   cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]'::jsonb)) p
   where s.id=1 and p->>'id'=request_row.patient_id;
  if patient is null or nullif(trim(patient->>'name'),'') is null then raise exception 'Paciente não encontrado';end if;
  if nullif(regexp_replace(coalesce(patient->>'cpf',''),'[^0-9]','','g'),'') is not null
   and regexp_replace(patient->>'cpf','[^0-9]','','g')<>cpf then
   raise exception 'CPF diferente do cadastro do paciente. Corrija o cadastro ou selecione Outra pessoa';
  end if;
  name:=trim(patient->>'name');
 end if;
 if name='' or length(name)>200 then raise exception 'Informe o nome do tomador (até 200 caracteres)';end if;
 address_value:=nullif(trim(coalesce(p_data->>'taker_address','')),'');
 note_value:=nullif(trim(coalesce(p_data->>'notes','')),'');
 if length(coalesce(address_value,''))>1000 or length(coalesce(note_value,''))>2000 then
  raise exception 'Endereço ou observação excede o limite';
 end if;
 if kind=request_row.taker_kind and name=request_row.taker_name and cpf=request_row.taker_tax_id
    and address_value is not distinct from request_row.taker_address
    and note_value is not distinct from request_row.notes then return request_row.id;end if;
 perform public.financial_operation(p_actor,'edit_invoice_request',request_row.id::text);
 update public.invoice_requests
  set taker_kind=kind,taker_name=name,taker_tax_id=cpf,taker_address=address_value,notes=note_value
  where id=request_row.id;
 perform set_config('rn.operation','',true);
 perform set_config('rn.actor','',true);
 return request_row.id;
end;$function$;

revoke all on function public.update_pending_invoice_request(bigint,jsonb) from public,anon,authenticated;
grant execute on function public.update_pending_invoice_request(bigint,jsonb) to service_role;
