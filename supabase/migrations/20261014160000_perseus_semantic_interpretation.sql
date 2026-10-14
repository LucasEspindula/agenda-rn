-- Perseu Fase 3B: persiste interpretação semântica junto do replace estrutural.
create or replace function public.replace_perseus_document_analysis(
 p_document_id uuid,
 p_items jsonb,
 p_parser_key text,
 p_parser_version text,
 p_perseus_metadata jsonb,
 p_updated_by bigint
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
 v_document public.insurance_documents%rowtype;
begin
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>2000 then
  raise exception 'Itens do Perseu inválidos.' using errcode='22023';
 end if;

 select * into v_document
 from public.insurance_documents
 where id=p_document_id
 for update;

 if not found then
  raise exception 'Documento não encontrado.' using errcode='P0002';
 end if;
 if v_document.upload_status<>'READY' then
  raise exception 'Somente documentos prontos podem ser analisados.' using errcode='55000';
 end if;
 if exists (
  select 1
  from jsonb_to_recordset(p_items) as item(source_index integer,raw_data jsonb,normalized_data jsonb,source_metadata jsonb)
  where item.source_index is null or item.source_index<0 or item.raw_data is null
    or item.normalized_data is not null and jsonb_typeof(item.normalized_data)<>'object'
 ) or exists (
  select 1
  from jsonb_to_recordset(p_items) as item(source_index integer)
  group by item.source_index
  having count(*)>1
 ) then
  raise exception 'Itens do Perseu inválidos.' using errcode='22023';
 end if;

 -- Future confirmed matches must never be erased by an automatic reanalysis.
 if exists (
  select 1 from public.insurance_document_items
  where document_id=p_document_id
    and (attendance_id is not null or billing_record_id is not null
      or coalesce(match_status,'UNMATCHED') not in ('UNMATCHED',''))
 ) then
  raise exception 'O documento possui registros vinculados e não pode ser reanalisado automaticamente.' using errcode='55000';
 end if;

 delete from public.insurance_document_items where document_id=p_document_id;

 insert into public.insurance_document_items(
  document_id,source_index,raw_data,normalized_data,source_metadata,match_status,match_evidence,
  patient_name,beneficiary_number,guide_number,external_reference,service_date,procedure_code,
  procedure_description,amount_presented,amount_approved,amount_glossed,gloss_code,gloss_reason
 )
 select
  p_document_id,item.source_index,item.raw_data,coalesce(item.normalized_data,'{}'::jsonb),
  jsonb_strip_nulls(jsonb_build_object(
   'sheet',item.source_metadata->'sheet',
   'row',item.source_metadata->'row',
   'path',item.source_metadata->'path',
   'table_id',item.source_metadata->'table_id',
   'region',item.source_metadata->'region'
  )),
  'UNMATCHED',coalesce(item.semantic_evidence,'{}'::jsonb),
  item.patient_name,item.beneficiary_number,item.guide_number,item.external_reference,
  item.service_date,item.procedure_code,item.procedure_description,item.amount_presented,
  item.amount_approved,item.amount_glossed,item.gloss_code,item.gloss_reason
 from jsonb_to_recordset(p_items) as item(
  source_index integer,raw_data jsonb,normalized_data jsonb,semantic_evidence jsonb,source_metadata jsonb,
  patient_name text,beneficiary_number text,guide_number text,external_reference text,service_date date,
  procedure_code text,procedure_description text,amount_presented numeric,amount_approved numeric,
  amount_glossed numeric,gloss_code text,gloss_reason text
 )
 order by item.source_index;

 update public.insurance_documents
 set parser_key=p_parser_key,
     parser_version=p_parser_version,
     raw_metadata=coalesce(raw_metadata,'{}'::jsonb)||jsonb_build_object('perseus',coalesce(p_perseus_metadata,'{}'::jsonb)),
     perseus_status='REVIEW_REQUIRED',
     updated_at=now(),
     updated_by=p_updated_by
 where id=p_document_id;
end;
$$;

revoke all on function public.replace_perseus_document_analysis(uuid,jsonb,text,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.replace_perseus_document_analysis(uuid,jsonb,text,text,jsonb,bigint) to service_role;
