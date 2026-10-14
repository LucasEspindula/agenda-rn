-- Perseu Fase 3C: revisão humana auditável e memória de mapeamentos estritamente compatíveis.
create table if not exists public.perseus_semantic_reviews (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.insurance_documents(id) on delete cascade,
 table_id text not null,
 source_key text not null,
 semantic_field text,
 state text not null check (state in ('CONFIRMED','REJECTED','SUPERSEDED')),
 applied_item_count integer not null default 0,
 supersedes_review_id uuid references public.perseus_semantic_reviews(id),
 created_at timestamptz not null default now(),
 created_by bigint not null
);
create unique index if not exists perseus_semantic_reviews_current_key
 on public.perseus_semantic_reviews(document_id,table_id,source_key) where state in ('CONFIRMED','REJECTED');

create table if not exists public.perseus_semantic_rules (
 id uuid primary key default gen_random_uuid(),
 domain text not null check (domain='INSURANCE'),
 billing_entity_id uuid not null references public.billing_entities(id),
 payer_normalized text not null,
 movement_kind text not null,
 layout_fingerprint text not null,
 table_signature text not null,
 column_normalized text not null,
 semantic_field text,
 state text not null default 'ACTIVE' check (state in ('ACTIVE','REVOKED','SUPERSEDED')),
 version integer not null default 1,
 source_document_id uuid not null references public.insurance_documents(id),
 supersedes_rule_id uuid references public.perseus_semantic_rules(id),
 created_at timestamptz not null default now(),
 created_by bigint not null,
 revoked_at timestamptz,
 revoked_by bigint
);
create index if not exists perseus_semantic_rules_lookup
 on public.perseus_semantic_rules(domain,billing_entity_id,payer_normalized,movement_kind,layout_fingerprint,table_signature,column_normalized)
 where state='ACTIVE';

create table if not exists public.perseus_semantic_value_corrections (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.insurance_documents(id) on delete cascade,
 item_id uuid not null references public.insurance_document_items(id) on delete cascade,
 semantic_field text not null,
 normalized_value text,
 state text not null default 'ACTIVE' check (state in ('ACTIVE','SUPERSEDED')),
 supersedes_correction_id uuid references public.perseus_semantic_value_corrections(id),
 created_at timestamptz not null default now(),
 created_by bigint not null
);
create unique index if not exists perseus_semantic_value_corrections_current_key
 on public.perseus_semantic_value_corrections(item_id,semantic_field) where state='ACTIVE';

alter table public.perseus_semantic_reviews enable row level security;
alter table public.perseus_semantic_rules enable row level security;
alter table public.perseus_semantic_value_corrections enable row level security;
revoke all on table public.perseus_semantic_reviews,public.perseus_semantic_rules,public.perseus_semantic_value_corrections from public,anon,authenticated;
grant all on table public.perseus_semantic_reviews,public.perseus_semantic_rules,public.perseus_semantic_value_corrections to service_role;

-- Never erase human review/value corrections during automatic structural reanalysis.
create or replace function public.replace_perseus_document_analysis(
 p_document_id uuid,p_items jsonb,p_parser_key text,p_parser_version text,p_perseus_metadata jsonb,p_updated_by bigint
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_document public.insurance_documents%rowtype;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>2000 then raise exception 'Itens do Perseu inválidos.' using errcode='22023'; end if;
 select * into v_document from public.insurance_documents where id=p_document_id for update;
 if not found then raise exception 'Documento não encontrado.' using errcode='P0002'; end if;
 if v_document.upload_status<>'READY' then raise exception 'Somente documentos prontos podem ser analisados.' using errcode='55000'; end if;
 if exists(select 1 from public.perseus_semantic_reviews where document_id=p_document_id and state in ('CONFIRMED','REJECTED')) or exists(select 1 from public.perseus_semantic_value_corrections where document_id=p_document_id and state='ACTIVE') then raise exception 'O documento possui revisão humana e não pode ser reanalisado automaticamente.' using errcode='55000'; end if;
 if exists(select 1 from public.insurance_document_items where document_id=p_document_id and (attendance_id is not null or billing_record_id is not null or coalesce(match_status,'UNMATCHED') not in ('UNMATCHED',''))) then raise exception 'O documento possui registros vinculados e não pode ser reanalisado automaticamente.' using errcode='55000'; end if;
 if exists(select 1 from jsonb_to_recordset(p_items) as item(source_index integer,raw_data jsonb,normalized_data jsonb) where item.source_index is null or item.source_index<0 or item.raw_data is null or item.normalized_data is not null and jsonb_typeof(item.normalized_data)<>'object') or exists(select 1 from jsonb_to_recordset(p_items) as item(source_index integer) group by item.source_index having count(*)>1) then raise exception 'Itens do Perseu inválidos.' using errcode='22023'; end if;
 delete from public.insurance_document_items where document_id=p_document_id;
 insert into public.insurance_document_items(document_id,source_index,raw_data,normalized_data,source_metadata,match_status,match_evidence,patient_name,beneficiary_number,guide_number,external_reference,service_date,procedure_code,procedure_description,amount_presented,amount_approved,amount_glossed,gloss_code,gloss_reason)
 select p_document_id,item.source_index,item.raw_data,coalesce(item.normalized_data,'{}'::jsonb),coalesce(item.source_metadata,'{}'::jsonb),'UNMATCHED',coalesce(item.semantic_evidence,'{}'::jsonb),item.patient_name,item.beneficiary_number,item.guide_number,item.external_reference,item.service_date,item.procedure_code,item.procedure_description,item.amount_presented,item.amount_approved,item.amount_glossed,item.gloss_code,item.gloss_reason
 from jsonb_to_recordset(p_items) as item(source_index integer,raw_data jsonb,normalized_data jsonb,semantic_evidence jsonb,source_metadata jsonb,patient_name text,beneficiary_number text,guide_number text,external_reference text,service_date date,procedure_code text,procedure_description text,amount_presented numeric,amount_approved numeric,amount_glossed numeric,gloss_code text,gloss_reason text) order by item.source_index;
 update public.insurance_documents set parser_key=p_parser_key,parser_version=p_parser_version,raw_metadata=coalesce(raw_metadata,'{}'::jsonb)||jsonb_build_object('perseus',coalesce(p_perseus_metadata,'{}'::jsonb)),perseus_status='REVIEW_REQUIRED',updated_at=now(),updated_by=p_updated_by where id=p_document_id;
end $$;
revoke all on function public.replace_perseus_document_analysis(uuid,jsonb,text,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.replace_perseus_document_analysis(uuid,jsonb,text,text,jsonb,bigint) to service_role;

create or replace function public.apply_perseus_semantic_review(
 p_document_id uuid,p_table_id text,p_source_key text,p_semantic_field text,p_learn boolean,p_context jsonb,p_expected_updated_at timestamptz,p_updated_by bigint
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_document public.insurance_documents%rowtype; v_count integer; v_previous uuid; v_rule uuid;
begin
 if p_semantic_field is not null and p_semantic_field not in ('patient_name','beneficiary_number','guide_number','external_reference','service_date','procedure_code','procedure_description','amount_presented','amount_approved','amount_glossed','gloss_code','gloss_reason') then raise exception 'Significado inválido.' using errcode='22023'; end if;
 select * into v_document from public.insurance_documents where id=p_document_id for update;
 if not found or v_document.upload_status<>'READY' then raise exception 'Documento não disponível.' using errcode='55000'; end if;
 if p_expected_updated_at is null or v_document.updated_at is distinct from p_expected_updated_at then raise exception 'O documento mudou. Atualize a prévia antes de revisar.' using errcode='40001'; end if;
 if not exists(select 1 from public.insurance_document_items where document_id=p_document_id and source_metadata->>'table_id'=p_table_id and raw_data ? p_source_key) then raise exception 'Coluna não pertence à estrutura selecionada.' using errcode='22023'; end if;
 if exists(select 1 from public.perseus_semantic_value_corrections c join public.insurance_document_items i on i.id=c.item_id where c.document_id=p_document_id and c.state='ACTIVE' and i.source_metadata->>'table_id'=p_table_id) then raise exception 'Esta estrutura possui correções individuais. Revise-as antes de alterar o mapeamento.' using errcode='55000'; end if;
 update public.perseus_semantic_reviews set state='SUPERSEDED' where document_id=p_document_id and table_id=p_table_id and source_key=p_source_key and state in ('CONFIRMED','REJECTED') returning id into v_previous;
 update public.insurance_document_items set normalized_data=normalized_data-p_semantic_field, match_evidence=match_evidence-p_semantic_field,
  patient_name=case when p_semantic_field='patient_name' then null else patient_name end,beneficiary_number=case when p_semantic_field='beneficiary_number' then null else beneficiary_number end,guide_number=case when p_semantic_field='guide_number' then null else guide_number end,external_reference=case when p_semantic_field='external_reference' then null else external_reference end,service_date=case when p_semantic_field='service_date' then null else service_date end,procedure_code=case when p_semantic_field='procedure_code' then null else procedure_code end,procedure_description=case when p_semantic_field='procedure_description' then null else procedure_description end,amount_presented=case when p_semantic_field='amount_presented' then null else amount_presented end,amount_approved=case when p_semantic_field='amount_approved' then null else amount_approved end,amount_glossed=case when p_semantic_field='amount_glossed' then null else amount_glossed end,gloss_code=case when p_semantic_field='gloss_code' then null else gloss_code end,gloss_reason=case when p_semantic_field='gloss_reason' then null else gloss_reason end
 where document_id=p_document_id and source_metadata->>'table_id'=p_table_id;
 insert into public.perseus_semantic_reviews(document_id,table_id,source_key,semantic_field,state,applied_item_count,supersedes_review_id,created_by) select p_document_id,p_table_id,p_source_key,p_semantic_field,case when p_semantic_field is null then 'REJECTED' else 'CONFIRMED' end,count(*),v_previous,p_updated_by from public.insurance_document_items where document_id=p_document_id and source_metadata->>'table_id'=p_table_id;
 get diagnostics v_count=row_count;
 if p_learn then
  perform pg_advisory_xact_lock(hashtext(coalesce(p_context->>'layout_fingerprint','')||'/'||p_source_key));
  if exists(select 1 from public.perseus_semantic_rules where state='ACTIVE' and domain='INSURANCE' and billing_entity_id=(p_context->>'billing_entity_id')::uuid and payer_normalized=p_context->>'payer_normalized' and movement_kind=p_context->>'movement_kind' and layout_fingerprint=p_context->>'layout_fingerprint' and table_signature=p_context->>'table_signature' and column_normalized=p_context->>'column_normalized' and semantic_field is distinct from p_semantic_field) then raise exception 'Há uma regra aprendida conflitante; revogue-a antes de ensinar outra.' using errcode='23505'; end if;
  insert into public.perseus_semantic_rules(domain,billing_entity_id,payer_normalized,movement_kind,layout_fingerprint,table_signature,column_normalized,semantic_field,source_document_id,created_by) values('INSURANCE',(p_context->>'billing_entity_id')::uuid,p_context->>'payer_normalized',p_context->>'movement_kind',p_context->>'layout_fingerprint',p_context->>'table_signature',p_context->>'column_normalized',p_semantic_field,p_document_id,p_updated_by) returning id into v_rule;
 end if;
 update public.insurance_documents set updated_at=now(),updated_by=p_updated_by where id=p_document_id;
 return jsonb_build_object('applied_item_count',v_count,'rule_id',v_rule);
end $$;
revoke all on function public.apply_perseus_semantic_review(uuid,text,text,text,boolean,jsonb,timestamptz,bigint) from public,anon,authenticated;
grant execute on function public.apply_perseus_semantic_review(uuid,text,text,text,boolean,jsonb,timestamptz,bigint) to service_role;

create or replace function public.apply_perseus_semantic_value_correction(
 p_document_id uuid,p_item_id uuid,p_semantic_field text,p_normalized_value text,p_expected_updated_at timestamptz,p_updated_by bigint
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_document public.insurance_documents%rowtype; v_previous uuid;
begin
 if p_semantic_field not in ('patient_name','beneficiary_number','guide_number','external_reference','service_date','procedure_code','procedure_description','amount_presented','amount_approved','amount_glossed','gloss_code','gloss_reason') then raise exception 'Significado inválido.' using errcode='22023'; end if;
 select * into v_document from public.insurance_documents where id=p_document_id for update;
 if not found or v_document.upload_status<>'READY' then raise exception 'Documento não disponível.' using errcode='55000'; end if;
 if p_expected_updated_at is null or v_document.updated_at is distinct from p_expected_updated_at then raise exception 'O documento mudou. Atualize a prévia antes de corrigir.' using errcode='40001'; end if;
 if not exists(select 1 from public.insurance_document_items where id=p_item_id and document_id=p_document_id) then raise exception 'Item não pertence ao documento.' using errcode='22023'; end if;
 update public.perseus_semantic_value_corrections set state='SUPERSEDED' where item_id=p_item_id and semantic_field=p_semantic_field and state='ACTIVE' returning id into v_previous;
 insert into public.perseus_semantic_value_corrections(document_id,item_id,semantic_field,normalized_value,supersedes_correction_id,created_by) values(p_document_id,p_item_id,p_semantic_field,p_normalized_value,v_previous,p_updated_by);
 update public.insurance_document_items set normalized_data=jsonb_set(normalized_data,array[p_semantic_field],to_jsonb(p_normalized_value),true),match_evidence=jsonb_set(match_evidence,array[p_semantic_field],jsonb_build_object('origin','USER_CONFIRMED','corrected',true),true),
 patient_name=case when p_semantic_field='patient_name' then p_normalized_value else patient_name end,beneficiary_number=case when p_semantic_field='beneficiary_number' then p_normalized_value else beneficiary_number end,guide_number=case when p_semantic_field='guide_number' then p_normalized_value else guide_number end,external_reference=case when p_semantic_field='external_reference' then p_normalized_value else external_reference end,service_date=case when p_semantic_field='service_date' and p_normalized_value is not null then p_normalized_value::date else service_date end,procedure_code=case when p_semantic_field='procedure_code' then p_normalized_value else procedure_code end,procedure_description=case when p_semantic_field='procedure_description' then p_normalized_value else procedure_description end,amount_presented=case when p_semantic_field='amount_presented' and p_normalized_value is not null then p_normalized_value::numeric else amount_presented end,amount_approved=case when p_semantic_field='amount_approved' and p_normalized_value is not null then p_normalized_value::numeric else amount_approved end,amount_glossed=case when p_semantic_field='amount_glossed' and p_normalized_value is not null then p_normalized_value::numeric else amount_glossed end,gloss_code=case when p_semantic_field='gloss_code' then p_normalized_value else gloss_code end,gloss_reason=case when p_semantic_field='gloss_reason' then p_normalized_value else gloss_reason end where id=p_item_id and document_id=p_document_id;
 update public.insurance_documents set updated_at=now(),updated_by=p_updated_by where id=p_document_id;
end $$;
revoke all on function public.apply_perseus_semantic_value_correction(uuid,uuid,text,text,timestamptz,bigint) from public,anon,authenticated;
grant execute on function public.apply_perseus_semantic_value_correction(uuid,uuid,text,text,timestamptz,bigint) to service_role;
