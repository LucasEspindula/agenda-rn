-- Perseu Fase 3A: preserva a identidade física da região detectada em reanálises atômicas.
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
  from jsonb_to_recordset(p_items) as item(source_index integer,raw_data jsonb,source_metadata jsonb)
  where item.source_index is null or item.source_index<0 or item.raw_data is null
 ) or exists (
  select 1
  from jsonb_to_recordset(p_items) as item(source_index integer,raw_data jsonb,source_metadata jsonb)
  group by item.source_index
  having count(*)>1
 ) then
  raise exception 'Itens do Perseu inválidos.' using errcode='22023';
 end if;

 delete from public.insurance_document_items where document_id=p_document_id;

 insert into public.insurance_document_items(document_id,source_index,raw_data,normalized_data,source_metadata,match_status)
 select p_document_id,item.source_index,item.raw_data,'{}'::jsonb,
        jsonb_strip_nulls(jsonb_build_object(
         'sheet',item.source_metadata->'sheet',
         'row',item.source_metadata->'row',
         'path',item.source_metadata->'path',
         'table_id',item.source_metadata->'table_id',
         'region',item.source_metadata->'region'
        )),
        'UNMATCHED'
 from jsonb_to_recordset(p_items) as item(source_index integer,raw_data jsonb,source_metadata jsonb)
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
