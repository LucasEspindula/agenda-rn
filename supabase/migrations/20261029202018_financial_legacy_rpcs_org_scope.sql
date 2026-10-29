-- RN Integra 2B/2b2b-1: tenant-scope four legacy financial RPCs; no record deletion.
-- RN Gestão-only guard remains. Not authorization to onboard new tenants.
BEGIN;

CREATE OR REPLACE FUNCTION public.attribute_financial_attendance(p_id text, p_entity uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.attendances%rowtype;alternate text; rn_org_id uuid;
begin
 rn_org_id:=public.rn_finance_single_organization_id();
 if not exists(select 1 from public.billing_entities where id=p_entity and organization_id=rn_org_id) then raise exception 'Entidade recebedora não encontrada nesta organização';end if;
 select * into t from public.attendances where id=p_id and organization_id=rn_org_id;
 if t.id is null then return null;end if;
 if t.appointment_id is not null and not exists(select 1 from public.billing_records where attendance_id=t.id and organization_id=rn_org_id)
 and not exists(select 1 from public.billing_doctor_entities where doctor_id=t.doctor_id and billing_entity_id=p_entity and organization_id=rn_org_id and active) then
  select a->>'anesthetistId' into alternate from public.app_state s cross join lateral jsonb_array_elements(coalesce(s.payload->'appointments','[]')) a where s.organization_id=rn_org_id and a->>'id'=t.appointment_id;
  if alternate is not null and exists(select 1 from public.billing_doctor_entities where doctor_id=alternate and billing_entity_id=p_entity and organization_id=rn_org_id and active) then
   update public.attendances set doctor_id=alternate where id=t.id and organization_id=rn_org_id;
  end if;
 end if;
 return public.financial_attendance(p_id);
end;$function$;

CREATE OR REPLACE FUNCTION public.financial_log_snapshot(v jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when v is null then null else v||jsonb_build_object('_labels',jsonb_strip_nulls(jsonb_build_object(
 'doctor_id',(select name from public.doctors where organization_id=public.rn_finance_single_organization_id() and id=v->>'doctor_id'),
 'billing_entity_id',(select name from public.billing_entities where organization_id=public.rn_finance_single_organization_id() and id::text=v->>'billing_entity_id'),
 'paid_by_doctor_entity_link_id',(select d.name from public.billing_doctor_entities l join public.doctors d on d.id=l.doctor_id and d.organization_id=l.organization_id where l.organization_id=public.rn_finance_single_organization_id() and l.id::text=v->>'paid_by_doctor_entity_link_id'),
 'paid_by_associate_id',(select name from public.company_associates where id::text=v->>'paid_by_associate_id'),
 'invoice_id',(select invoice_number from public.invoices where organization_id=public.rn_finance_single_organization_id() and id::text=v->>'invoice_id'),
 'patient_id',(select p->>'name' from public.app_state s cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]')) p where s.organization_id=public.rn_finance_single_organization_id() and p->>'id'=v->>'patient_id' limit 1)
 ))) end
$function$;

CREATE OR REPLACE FUNCTION public.finish_private_payment(p_actor bigint, p_id uuid, p_data jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.billing_records%rowtype;a public.attendances%rowtype;r public.invoice_requests%rowtype;f jsonb:=p_data->'fiscal';patient jsonb;cpf text;rn_org_id uuid;
begin
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
 select * into b from public.billing_records where id=p_id and organization_id=rn_org_id;
 if b.id is null then raise exception 'Cobrança não encontrada na organização';end if;
 if b.payment_status='PENDENTE' then
  update public.billing_records set no_invoice=false where id=p_id and organization_id=rn_org_id and no_invoice; update public.invoice_requests set status='CANCELLED' where billing_record_id=p_id and organization_id=rn_org_id and status='PENDING';return;end if;
 if b.billing_method<>'PARTICULAR' then
   update public.billing_records set no_invoice=false where id=p_id and organization_id=rn_org_id and no_invoice;
   return;
 end if;
 if coalesce((p_data->>'no_invoice')::boolean,false) then
  if exists(select 1 from public.invoice_requests
    where billing_record_id=p_id and organization_id=rn_org_id and status in ('PENDING','ISSUED')) then
    raise exception 'Solicitação de NF existente. Regularize antes de selecionar Sem Nota Fiscal';
  end if;
  if nullif(trim(b.invoice_number),'') is not null then
    raise exception 'Existe NF registrada: Sem Nota Fiscal não é permitido';
  end if;
  update public.billing_records set no_invoice=true where id=p_id and organization_id=rn_org_id and not no_invoice;
  return;
 end if;
 update public.billing_records set no_invoice=false where id=p_id and organization_id=rn_org_id and no_invoice;
 if nullif(trim(b.invoice_number),'') is not null then raise exception 'NF particular legada: preserve o documento e solicite regularização fiscal à gerência';end if;
 if f is null or coalesce(f->>'taker_kind','') not in ('PATIENT','OTHER') or nullif(trim(f->>'taker_name'),'') is null or not public.valid_cpf(f->>'taker_tax_id') then raise exception 'Confirme o pagamento e solicite NF com nome e CPF válido do tomador';end if;
 cpf:=regexp_replace(f->>'taker_tax_id','[^0-9]','','g');select * into a from public.attendances where id=b.attendance_id and organization_id=rn_org_id;
 select p into patient from public.app_state s cross join lateral jsonb_array_elements(s.payload->'patients') p where s.organization_id=rn_org_id and p->>'id'=a.patient_id;
 if patient is null or nullif(trim(patient->>'name'),'') is null then raise exception 'Paciente não encontrado para confirmação fiscal';end if;
 if f->>'taker_kind'='PATIENT' and nullif(patient->>'cpf','') is not null and regexp_replace(patient->>'cpf','[^0-9]','','g')<>cpf then raise exception 'CPF diferente do cadastro. Corrija o paciente ou selecione Outra pessoa';end if;
 if f->>'taker_kind'='PATIENT' then
  f:=jsonb_set(f,'{taker_name}',to_jsonb(patient->>'name'));
  update public.app_state set payload=jsonb_set(payload,'{patients}',(select jsonb_agg(case when p->>'id'=a.patient_id then p||jsonb_build_object('cpf',cpf)||case when nullif(trim(f->>'taker_address'),'') is not null then jsonb_build_object('address',trim(f->>'taker_address')) else '{}'::jsonb end else p end order by n) from jsonb_array_elements(payload->'patients') with ordinality x(p,n))),updated_at=greatest(clock_timestamp(),updated_at+interval '1 millisecond') where organization_id=rn_org_id;
 end if;
 -- Uma solicitação pendente representa a próxima emissão, inclusive após desfazer a NF.
 -- Repetir a confirmação na Agenda não cria outro pedido nem altera snapshot fiscal.
 select * into r from public.invoice_requests
 where billing_record_id=p_id and organization_id=rn_org_id and status in ('PENDING','ISSUED') for update;
 if r.id is not null then
  if r.status='PENDING' and r.billing_entity_id=b.billing_entity_id
   and r.received_amount_snapshot is not distinct from b.received_amount
   and r.paid_at_snapshot is not distinct from b.paid_at
   and r.taker_kind=f->>'taker_kind'
   and r.taker_tax_id=cpf
   and r.taker_name=trim(f->>'taker_name')
   and r.taker_address is not distinct from nullif(trim(f->>'taker_address'),'')
   and r.notes is not distinct from nullif(trim(f->>'notes'),'')
  then return; end if;
  raise exception 'Já existe solicitação fiscal para este pagamento. Use Faturamento > Notas Fiscais > Solicitações. Para mudar valor, data ou tomador, reverta o pagamento de forma auditada.';
 end if;
 insert into public.invoice_requests(attendance_id,billing_record_id,billing_entity_id,taker_kind,taker_name,taker_tax_id,taker_address,notes,received_amount_snapshot,paid_at_snapshot,patient_id,patient_name_snapshot,doctor_id,doctor_name_snapshot,attendance_date_snapshot,procedure_snapshot,entity_name_snapshot,entity_tax_id_snapshot)
 select a.id,b.id,b.billing_entity_id,f->>'taker_kind',trim(f->>'taker_name'),cpf,nullif(trim(f->>'taker_address'),''),nullif(trim(f->>'notes'),''),b.received_amount,b.paid_at,a.patient_id,patient->>'name',a.doctor_id,d.name,a.date,a.procedure,e.name,e.tax_id from public.billing_entities e cross join public.doctors d where e.id=b.billing_entity_id and e.organization_id=rn_org_id and d.id=a.doctor_id and d.organization_id=rn_org_id;
end;$function$;

CREATE OR REPLACE FUNCTION public.update_pending_invoice_request(p_actor bigint, p_data jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare request_row public.invoice_requests%rowtype;
        actor_role text; kind text; name text; cpf text; address_value text; note_value text;
        patient jsonb; expected timestamptz; linked public.billing_records%rowtype; rn_org_id uuid;
begin
 perform pg_advisory_xact_lock(194701,1);
 perform pg_advisory_xact_lock(194701,2);
 rn_org_id:=public.require_rn_agenda_actor_organization(p_actor);
 select role into actor_role from public.users where id=p_actor;
 if actor_role not in ('general_manager','secretary') then raise exception 'Sem permissão para corrigir solicitações fiscais';end if;
 if nullif(p_data->>'id','') is null or nullif(p_data->>'updated_at','') is null then raise exception 'Solicitação e versão obrigatórias';end if;
 select * into request_row from public.invoice_requests where id=(p_data->>'id')::uuid and organization_id=rn_org_id for update;
 if request_row.id is null then raise exception 'Solicitação fiscal não encontrada';end if;
 if request_row.status<>'PENDING' or request_row.invoice_id is not null then
  raise exception 'A NF já foi emitida ou a solicitação não está pendente. Faça a correção fiscal na NF';
 end if;
 expected:=(p_data->>'updated_at')::timestamptz;
 if request_row.updated_at is distinct from expected then raise exception 'Solicitação alterada por outra pessoa. Atualize antes de editar';end if;
 select * into linked from public.billing_records where id=request_row.billing_record_id and organization_id=rn_org_id for update;
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
  where s.organization_id=rn_org_id and appointment->>'id'=linked.appointment_id
 ) then raise exception 'Acesso negado à agenda desta solicitação';end if;
 kind:=p_data->>'taker_kind';
 if kind not in ('PATIENT','OTHER') then raise exception 'Selecione Próprio paciente ou Outra pessoa';end if;
 cpf:=regexp_replace(coalesce(p_data->>'taker_tax_id',''),'[^0-9]','','g');
 if not public.valid_cpf(cpf) then raise exception 'Informe um CPF válido';end if;
 name:=trim(coalesce(p_data->>'taker_name',''));
 if kind='PATIENT' then
  select p into patient from public.app_state s
   cross join lateral jsonb_array_elements(coalesce(s.payload->'patients','[]'::jsonb)) p
   where s.organization_id=rn_org_id and p->>'id'=request_row.patient_id;
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
  where id=request_row.id and organization_id=rn_org_id;
 perform set_config('rn.operation','',true);
 perform set_config('rn.actor','',true);
 return request_row.id;
end;$function$;

REVOKE ALL ON FUNCTION public.attribute_financial_attendance(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attribute_financial_attendance(text,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.financial_log_snapshot(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.financial_log_snapshot(jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.finish_private_payment(bigint,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_private_payment(bigint,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.update_pending_invoice_request(bigint,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_pending_invoice_request(bigint,jsonb) TO service_role;

COMMIT;
