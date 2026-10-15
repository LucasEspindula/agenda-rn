-- Perseu: histórico operacional append-only. Esta migration não altera análises já persistidas.
create table public.perseus_document_events (
 id uuid primary key default gen_random_uuid(),
 document_id uuid not null references public.insurance_documents(id) on delete restrict,
 event_type text not null check (event_type in (
  'DOCUMENT_IMPORTED','IMPORT_REJECTED','FORMAT_UNSUPPORTED','ANALYSIS_COMPLETED','STRUCTURE_IDENTIFIED',
  'SEMANTIC_INTERPRETATION_COMPLETED','SEMANTIC_CONFLICT_IDENTIFIED','LEARNED_SUGGESTION_REUSED',
  'MAPPING_REVIEW_APPLIED','MAPPING_REVIEW_REJECTED','MAPPING_REVIEW_REPLACED','LEARNED_RULE_CREATED',
  'LEARNED_RULE_REUSED','LEARNED_RULE_REVOKED','INDIVIDUAL_CORRECTION_APPLIED','REANALYSIS_BLOCKED','ANALYSIS_FAILED'
 )),
 event_origin text not null check (event_origin in ('SYSTEM','SEMANTIC_ENGINE','LEARNED_KNOWLEDGE','USER','HISTORICAL_RECONSTRUCTED')),
 occurred_at timestamptz not null default now(), actor_id bigint,
 operation_id uuid not null default gen_random_uuid(), parser_version text, semantic_version text,
 related_review_id uuid references public.perseus_semantic_reviews(id),
 related_rule_id uuid references public.perseus_semantic_rules(id),
 related_correction_id uuid references public.perseus_semantic_value_corrections(id),
 event_metadata jsonb not null default '{}'::jsonb, event_version integer not null default 1,
 check (jsonb_typeof(event_metadata)='object')
);
create index perseus_document_events_document_order on public.perseus_document_events(document_id,occurred_at desc,id desc);
create unique index perseus_document_events_operation_once on public.perseus_document_events(document_id,event_type,operation_id);
alter table public.perseus_document_events enable row level security;
revoke all on table public.perseus_document_events from public,anon,authenticated;
grant select,insert on table public.perseus_document_events to service_role;

-- Automatic replacement remains all-or-nothing and now records only consolidated, non-sensitive facts.
create or replace function public.replace_perseus_document_analysis(
 p_document_id uuid,p_items jsonb,p_parser_key text,p_parser_version text,p_perseus_metadata jsonb,p_updated_by bigint
) returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_document public.insurance_documents%rowtype; v_tables integer; v_columns integer; v_records integer; v_semantic integer; v_conflicts integer; v_rule record; v_operation uuid:=gen_random_uuid();
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
 v_tables:=jsonb_array_length(coalesce(p_perseus_metadata->'structure'->'tables','[]'::jsonb)); v_columns:=coalesce((p_perseus_metadata->>'column_count')::integer,0); v_records:=coalesce((p_perseus_metadata->>'row_count')::integer,0);
 insert into public.perseus_document_events(document_id,event_type,event_origin,actor_id,operation_id,parser_version,semantic_version,event_metadata) values
  (p_document_id,'ANALYSIS_COMPLETED','SYSTEM',p_updated_by,v_operation,p_parser_version,p_perseus_metadata->'semantic'->>'version',jsonb_build_object('tables',v_tables,'columns',v_columns,'records',v_records)),
  (p_document_id,'STRUCTURE_IDENTIFIED','SYSTEM',p_updated_by,v_operation,p_parser_version,p_perseus_metadata->'semantic'->>'version',jsonb_build_object('tables',v_tables,'columns',v_columns,'records',v_records));
 select count(*) into v_semantic from jsonb_array_elements(coalesce(p_perseus_metadata->'semantic'->'tables','[]'::jsonb)) table_item cross join lateral jsonb_array_elements(coalesce(table_item->'columns','[]'::jsonb)) column_item where column_item->>'field' is not null;
 if v_semantic>0 then insert into public.perseus_document_events(document_id,event_type,event_origin,actor_id,operation_id,parser_version,semantic_version,event_metadata) values(p_document_id,'SEMANTIC_INTERPRETATION_COMPLETED','SEMANTIC_ENGINE',p_updated_by,v_operation,p_parser_version,p_perseus_metadata->'semantic'->>'version',jsonb_build_object('items',v_semantic)); end if;
 select count(*) into v_conflicts from jsonb_array_elements(coalesce(p_perseus_metadata->'semantic'->'tables','[]'::jsonb)) table_item cross join lateral jsonb_array_elements(coalesce(table_item->'columns','[]'::jsonb)) column_item where column_item->>'origin'='CONFLICT';
 if v_conflicts>0 then insert into public.perseus_document_events(document_id,event_type,event_origin,actor_id,operation_id,semantic_version,event_metadata) values(p_document_id,'SEMANTIC_CONFLICT_IDENTIFIED','SEMANTIC_ENGINE',p_updated_by,v_operation,p_perseus_metadata->'semantic'->>'version',jsonb_build_object('items',v_conflicts)); end if;
 for v_rule in select distinct (column_item->>'ruleId')::uuid as rule_id,left(coalesce(column_item->>'sourceColumn',''),80) as source_column,left(coalesce(column_item->>'field',''),80) as semantic_field from jsonb_array_elements(coalesce(p_perseus_metadata->'semantic'->'tables','[]'::jsonb)) table_item cross join lateral jsonb_array_elements(coalesce(table_item->'columns','[]'::jsonb)) column_item where column_item->>'origin'='LEARNED_SUGGESTION' and column_item->>'ruleId' is not null loop
  insert into public.perseus_document_events(document_id,event_type,event_origin,actor_id,operation_id,semantic_version,related_rule_id,event_metadata) values(p_document_id,'LEARNED_SUGGESTION_REUSED','LEARNED_KNOWLEDGE',p_updated_by,v_operation,p_perseus_metadata->'semantic'->>'version',v_rule.rule_id,jsonb_build_object('column',v_rule.source_column,'field',v_rule.semantic_field));
 end loop;
end $$;

create or replace function public.apply_perseus_semantic_review(
 p_document_id uuid,p_table_id text,p_source_key text,p_semantic_field text,p_learn boolean,p_context jsonb,p_item_updates jsonb,p_expected_updated_at timestamptz,p_updated_by bigint
) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_document public.insurance_documents%rowtype; v_entity uuid; v_payer text; v_kind text; v_fingerprint text; v_expected integer; v_count integer; v_previous uuid; v_review uuid; v_rule uuid; v_rule_action text; v_operation uuid:=gen_random_uuid();
begin
 if p_semantic_field is not null and p_semantic_field not in ('patient_name','beneficiary_number','guide_number','external_reference','service_date','procedure_code','procedure_description','amount_presented','amount_approved','amount_glossed','gloss_code','gloss_reason') then raise exception 'Significado inválido.' using errcode='22023'; end if;
 if jsonb_typeof(p_item_updates) is distinct from 'array' then raise exception 'Atualização de itens inválida.' using errcode='22023'; end if;
 select * into v_document from public.insurance_documents where id=p_document_id for update;
 if not found or v_document.upload_status<>'READY' then raise exception 'Documento não disponível.' using errcode='55000'; end if;
 select billing_entity_id,payer,kind into v_entity,v_payer,v_kind from public.insurance_movements where id=v_document.movement_id;
 if not found then raise exception 'Movimento do documento não encontrado.' using errcode='55000'; end if;
 if p_expected_updated_at is null or v_document.updated_at is distinct from p_expected_updated_at then raise exception 'O documento mudou. Atualize a prévia antes de revisar.' using errcode='40001'; end if;
 v_fingerprint:=coalesce(v_document.raw_metadata->'perseus'->>'layout_fingerprint','');
 if p_context->>'billing_entity_id' is distinct from v_entity::text or p_context->>'payer_normalized' is distinct from upper(regexp_replace(trim(v_payer),'\s+',' ','g')) or p_context->>'movement_kind' is distinct from v_kind or p_context->>'layout_fingerprint' is distinct from v_fingerprint then raise exception 'Contexto de aprendizado incompatível com o documento.' using errcode='22023'; end if;
 select count(*) into v_expected from public.insurance_document_items where document_id=p_document_id and source_metadata->>'table_id'=p_table_id and raw_data ? p_source_key;
 if v_expected=0 or jsonb_array_length(p_item_updates)<>v_expected then raise exception 'Os itens revisados não correspondem à coluna selecionada.' using errcode='22023'; end if;
 if exists(select 1 from public.perseus_semantic_value_corrections c join public.insurance_document_items i on i.id=c.item_id where c.document_id=p_document_id and c.state='ACTIVE' and i.source_metadata->>'table_id'=p_table_id) then raise exception 'Esta estrutura possui correções individuais. Revise-as antes de alterar o mapeamento.' using errcode='55000'; end if;
 update public.perseus_semantic_reviews set state='SUPERSEDED' where document_id=p_document_id and table_id=p_table_id and source_key=p_source_key and state in ('CONFIRMED','REJECTED') returning id into v_previous;
 with input as (select * from jsonb_to_recordset(p_item_updates) as x(id uuid,normalized_data jsonb,semantic_evidence jsonb,patient_name text,beneficiary_number text,guide_number text,external_reference text,service_date date,procedure_code text,procedure_description text,amount_presented numeric,amount_approved numeric,amount_glossed numeric,gloss_code text,gloss_reason text)) update public.insurance_document_items i set normalized_data=x.normalized_data,match_evidence=x.semantic_evidence,patient_name=x.patient_name,beneficiary_number=x.beneficiary_number,guide_number=x.guide_number,external_reference=x.external_reference,service_date=x.service_date,procedure_code=x.procedure_code,procedure_description=x.procedure_description,amount_presented=x.amount_presented,amount_approved=x.amount_approved,amount_glossed=x.amount_glossed,gloss_code=x.gloss_code,gloss_reason=x.gloss_reason from input x where i.id=x.id and i.document_id=p_document_id and i.source_metadata->>'table_id'=p_table_id and i.raw_data ? p_source_key;
 get diagnostics v_count=row_count;
 if v_count<>v_expected then raise exception 'A revisão não alcançou todos os itens esperados.' using errcode='40001'; end if;
 insert into public.perseus_semantic_reviews(document_id,table_id,source_key,semantic_field,state,applied_item_count,supersedes_review_id,created_by) values(p_document_id,p_table_id,p_source_key,p_semantic_field,case when p_semantic_field is null then 'REJECTED' else 'CONFIRMED' end,v_count,v_previous,p_updated_by) returning id into v_review;
 if p_learn and p_semantic_field is not null then
  perform pg_advisory_xact_lock(hashtext(concat_ws('/',p_context->>'billing_entity_id',p_context->>'payer_normalized',p_context->>'movement_kind',p_context->>'layout_fingerprint',p_context->>'table_signature',p_context->>'column_normalized')));
  select id into v_rule from public.perseus_semantic_rules where state='ACTIVE' and domain='INSURANCE' and billing_entity_id=v_entity and payer_normalized=p_context->>'payer_normalized' and movement_kind=v_kind and layout_fingerprint=v_fingerprint and table_signature=p_context->>'table_signature' and column_normalized=p_context->>'column_normalized' for update;
  if found then
   if (select semantic_field from public.perseus_semantic_rules where id=v_rule) is distinct from p_semantic_field then raise exception 'Há uma regra aprendida conflitante; revogue-a antes de ensinar outra.' using errcode='23505'; end if;
   v_rule_action:='REUSED';
  else
   insert into public.perseus_semantic_rules(domain,billing_entity_id,payer_normalized,movement_kind,layout_fingerprint,table_signature,column_normalized,semantic_field,source_document_id,created_by) values('INSURANCE',v_entity,p_context->>'payer_normalized',v_kind,v_fingerprint,p_context->>'table_signature',p_context->>'column_normalized',p_semantic_field,p_document_id,p_updated_by) returning id into v_rule;
   v_rule_action:='CREATED';
  end if;
 end if;
 insert into public.perseus_document_events(document_id,event_type,event_origin,actor_id,operation_id,semantic_version,related_review_id,event_metadata) values(p_document_id,case when p_semantic_field is null then 'MAPPING_REVIEW_REJECTED' else 'MAPPING_REVIEW_APPLIED' end,'USER',p_updated_by,v_operation,coalesce(v_document.raw_metadata->'perseus'->'semantic'->>'version','1.0.0'),v_review,jsonb_build_object('column',left(p_source_key,80),'field',coalesce(p_semantic_field,''),'items',v_count));
 if v_previous is not null then insert into public.perseus_document_events(document_id,event_type,event_origin,actor_id,operation_id,related_review_id,event_metadata) values(p_document_id,'MAPPING_REVIEW_REPLACED','USER',p_updated_by,v_operation,v_review,jsonb_build_object('column',left(p_source_key,80),'field',coalesce(p_semantic_field,''))); end if;
 if v_rule is not null then insert into public.perseus_document_events(document_id,event_type,event_origin,actor_id,operation_id,related_review_id,related_rule_id,event_metadata) values(p_document_id,case when v_rule_action='CREATED' then 'LEARNED_RULE_CREATED' else 'LEARNED_RULE_REUSED' end,'USER',p_updated_by,v_operation,v_review,v_rule,jsonb_build_object('column',left(p_source_key,80),'field',p_semantic_field)); end if;
 update public.insurance_documents set updated_at=now(),updated_by=p_updated_by where id=p_document_id;
 return jsonb_build_object('applied_item_count',v_count,'rule_id',v_rule,'rule_action',v_rule_action,'review_id',v_review);
end $$;

create or replace function public.apply_perseus_semantic_value_correction(p_document_id uuid,p_item_id uuid,p_semantic_field text,p_normalized_value text,p_expected_updated_at timestamptz,p_updated_by bigint)
returns void language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_document public.insurance_documents%rowtype; v_previous uuid; v_correction uuid; v_table text; v_operation uuid:=gen_random_uuid();
begin
 if p_semantic_field not in ('patient_name','beneficiary_number','guide_number','external_reference','service_date','procedure_code','procedure_description','amount_presented','amount_approved','amount_glossed','gloss_code','gloss_reason') then raise exception 'Significado inválido.' using errcode='22023'; end if;
 select * into v_document from public.insurance_documents where id=p_document_id for update;
 if not found or v_document.upload_status<>'READY' then raise exception 'Documento não disponível.' using errcode='55000'; end if;
 if p_expected_updated_at is null or v_document.updated_at is distinct from p_expected_updated_at then raise exception 'O documento mudou. Atualize a prévia antes de corrigir.' using errcode='40001'; end if;
 select source_metadata->>'table_id' into v_table from public.insurance_document_items where id=p_item_id and document_id=p_document_id;
 if not found then raise exception 'Item não pertence ao documento.' using errcode='22023'; end if;
 update public.perseus_semantic_value_corrections set state='SUPERSEDED' where item_id=p_item_id and semantic_field=p_semantic_field and state='ACTIVE' returning id into v_previous;
 insert into public.perseus_semantic_value_corrections(document_id,item_id,semantic_field,normalized_value,supersedes_correction_id,created_by) values(p_document_id,p_item_id,p_semantic_field,p_normalized_value,v_previous,p_updated_by) returning id into v_correction;
 update public.insurance_document_items set normalized_data=jsonb_set(normalized_data,array[p_semantic_field],to_jsonb(p_normalized_value),true),match_evidence=jsonb_set(match_evidence,array[p_semantic_field],jsonb_build_object('origin','USER_CONFIRMED','corrected',true),true),patient_name=case when p_semantic_field='patient_name' then p_normalized_value else patient_name end,beneficiary_number=case when p_semantic_field='beneficiary_number' then p_normalized_value else beneficiary_number end,guide_number=case when p_semantic_field='guide_number' then p_normalized_value else guide_number end,external_reference=case when p_semantic_field='external_reference' then p_normalized_value else external_reference end,service_date=case when p_semantic_field='service_date' then p_normalized_value::date else service_date end,procedure_code=case when p_semantic_field='procedure_code' then p_normalized_value else procedure_code end,procedure_description=case when p_semantic_field='procedure_description' then p_normalized_value else procedure_description end,amount_presented=case when p_semantic_field='amount_presented' then p_normalized_value::numeric else amount_presented end,amount_approved=case when p_semantic_field='amount_approved' then p_normalized_value::numeric else amount_approved end,amount_glossed=case when p_semantic_field='amount_glossed' then p_normalized_value::numeric else amount_glossed end,gloss_code=case when p_semantic_field='gloss_code' then p_normalized_value else gloss_code end,gloss_reason=case when p_semantic_field='gloss_reason' then p_normalized_value else gloss_reason end where id=p_item_id and document_id=p_document_id;
 insert into public.perseus_document_events(document_id,event_type,event_origin,actor_id,operation_id,related_correction_id,event_metadata) values(p_document_id,'INDIVIDUAL_CORRECTION_APPLIED','USER',p_updated_by,v_operation,v_correction,jsonb_build_object('field',p_semantic_field));
 update public.insurance_documents set updated_at=now(),updated_by=p_updated_by where id=p_document_id;
end $$;

create or replace function public.revoke_perseus_semantic_rule(p_rule_id uuid,p_updated_by bigint)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare v_rule public.perseus_semantic_rules%rowtype; v_operation uuid:=gen_random_uuid();
begin
 select * into v_rule from public.perseus_semantic_rules where id=p_rule_id for update;
 if not found then raise exception 'Regra aprendida não encontrada.' using errcode='P0002'; end if;
 if v_rule.state<>'ACTIVE' then raise exception 'A regra não está ativa.' using errcode='55000'; end if;
 update public.perseus_semantic_rules set state='REVOKED',revoked_at=now(),revoked_by=p_updated_by where id=p_rule_id;
 insert into public.perseus_document_events(document_id,event_type,event_origin,actor_id,operation_id,related_rule_id,event_metadata) values(v_rule.source_document_id,'LEARNED_RULE_REVOKED','USER',p_updated_by,v_operation,p_rule_id,jsonb_build_object('column',left(v_rule.column_normalized,80),'field',v_rule.semantic_field));
 return jsonb_build_object('rule_id',p_rule_id,'state','REVOKED');
end $$;

revoke all on function public.replace_perseus_document_analysis(uuid,jsonb,text,text,jsonb,bigint),public.apply_perseus_semantic_review(uuid,text,text,text,boolean,jsonb,jsonb,timestamptz,bigint),public.apply_perseus_semantic_value_correction(uuid,uuid,text,text,timestamptz,bigint),public.revoke_perseus_semantic_rule(uuid,bigint) from public,anon,authenticated;
grant execute on function public.replace_perseus_document_analysis(uuid,jsonb,text,text,jsonb,bigint),public.apply_perseus_semantic_review(uuid,text,text,text,boolean,jsonb,jsonb,timestamptz,bigint),public.apply_perseus_semantic_value_correction(uuid,uuid,text,text,timestamptz,bigint),public.revoke_perseus_semantic_rule(uuid,bigint) to service_role;
