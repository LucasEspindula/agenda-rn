-- Private payment proofs are distinct from fiscal documents. The object is kept in
-- Storage; this table carries only the audited metadata and its payment lifecycle.
create table public.financial_attachments (
 id uuid primary key default gen_random_uuid(),
 document_type text not null default 'PAYMENT_PROOF' check(document_type='PAYMENT_PROOF'),
 invoice_id uuid references public.invoices(id),
 billing_record_id uuid references public.billing_records(id),
 storage_path text not null unique,
 original_filename text not null check(length(trim(original_filename)) between 1 and 200),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
 file_size bigint not null check(file_size>0 and file_size<=10485760),
 status text not null default 'PENDING' check(status in ('PENDING','READY','REJECTED')),
 is_current boolean not null default false,
 replaces_attachment_id uuid references public.financial_attachments(id),
 replaced_by_attachment_id uuid unique references public.financial_attachments(id),
 deactivated_at timestamptz,
 deactivation_reason text check(deactivation_reason in ('REPLACED','PAYMENT_REVERSED')),
 created_at timestamptz not null default now(),
 created_by bigint not null references public.users(id),
 updated_at timestamptz not null default now(),
 updated_by bigint not null references public.users(id),
 check((invoice_id is null) <> (billing_record_id is null)),
 check(not is_current or status='READY')
);
create index financial_attachments_invoice_current on public.financial_attachments(invoice_id,created_at desc) where invoice_id is not null;
create index financial_attachments_record_current on public.financial_attachments(billing_record_id,created_at desc) where billing_record_id is not null;
alter table public.financial_attachments enable row level security;
revoke all on public.financial_attachments from public,anon,authenticated;
grant select,insert,update on public.financial_attachments to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('financial-documents','financial-documents',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf','image/jpeg','image/png'];

create or replace function public.financial_attachment_snapshot(value jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select case when value is null then null else jsonb_strip_nulls(jsonb_build_object(
  'document_type',value->'document_type','original_filename',value->'original_filename',
  'mime_type',value->'mime_type','file_size',value->'file_size','status',value->'status',
  'is_current',value->'is_current','deactivation_reason',value->'deactivation_reason',
  'invoice_id',value->'invoice_id','billing_record_id',value->'billing_record_id'
 )) end
$$;

create or replace function public.financial_attachment_log_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare op uuid:=nullif(current_setting('rn.operation',true),'')::uuid; actor public.users%rowtype; before_value jsonb; after_value jsonb; action_name text;
begin
 if op is null then raise exception 'Alteração financeira exige log';end if;
 select * into actor from public.users where id=nullif(current_setting('rn.actor',true),'')::bigint;
 if actor.id is null then raise exception 'Autor inválido';end if;
 if tg_op='INSERT' and new.status='PENDING' then return new;end if;
 if tg_op='UPDATE' and old.status='PENDING' and new.status='REJECTED' then return new;end if;
 before_value:=case when tg_op='INSERT' or (tg_op='UPDATE' and old.status='PENDING' and new.status='READY') then null else public.financial_attachment_snapshot(to_jsonb(old)) end;
 after_value:=case when tg_op='DELETE' then null else public.financial_attachment_snapshot(to_jsonb(new)) end;
 if tg_op='UPDATE' and before_value is not null and before_value=after_value then return new;end if;
 action_name:=case when before_value is null then 'INSERT' when after_value is null then 'DELETE' else 'UPDATE' end;
 insert into public.financial_logs(id,actor_id,actor_name,actor_email,kind,record_id)
 values(op,actor.id,coalesce(nullif(actor.name,''),actor.email,'Não informado'),actor.email,current_setting('rn.kind',true),nullif(current_setting('rn.record',true),'')) on conflict(id) do nothing;
 insert into public.financial_log_changes(log_id,record_type,record_id,action,before_data,after_data)
 values(op,'financial_attachments',coalesce(new.id,old.id)::text,action_name,before_value,after_value);
 return coalesce(new,old);
end;$$;
create trigger financial_attachment_stamp before insert or update on public.financial_attachments for each row execute function public.financial_stamp();
create trigger financial_attachment_log after insert or update or delete on public.financial_attachments for each row execute function public.financial_attachment_log_change();

create or replace function public.authorized_financial_attachment_actor(actor bigint, invoice uuid, record uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare role_name text;
begin
 select role into role_name from public.users where id=actor;
 if role_name='general_manager' then return true;end if;
 if role_name<>'secretary' then return false;end if;
 if record is not null then return exists(select 1 from public.billing_records b join public.attendances a on a.id=b.attendance_id join public.agenda_access g on g.user_id=actor and g.professional_id=a.doctor_id where b.id=record);end if;
 return not exists(select 1 from public.invoice_billing_records ib join public.billing_records b on b.id=ib.billing_record_id join public.attendances a on a.id=b.attendance_id where ib.invoice_id=invoice and not exists(select 1 from public.agenda_access g where g.user_id=actor and g.professional_id=a.doctor_id))
  and exists(select 1 from public.invoice_billing_records where invoice_id=invoice);
end;$$;

create or replace function public.begin_financial_attachment(p_actor bigint,p_invoice uuid,p_record uuid,p_filename text,p_mime text,p_size bigint,p_replaces uuid default null) returns table(id uuid,storage_path text) language plpgsql security invoker set search_path='' as $$
declare attachment_id uuid:=gen_random_uuid(); current_attachment public.financial_attachments%rowtype;
begin
 if not public.authorized_financial_attachment_actor(p_actor,p_invoice,p_record) then raise exception 'Acesso negado';end if;
 if p_invoice is not null and not exists(select 1 from public.invoices where id=p_invoice and recipient_type='CONVENIO' and status='ACTIVE' and voided_at is null and paid_at is not null) then raise exception 'NF paga não encontrada';end if;
 if p_record is not null and not exists(select 1 from public.billing_records where id=p_record and payment_status='PAGO' and paid_at is not null and received_amount is not null and (billing_method='PARTICULAR' or settlement_mode='DIRECT')) then raise exception 'Pagamento direto não encontrado';end if;
 if p_filename is null or p_filename<>trim(p_filename) or p_filename~'[\\/[:cntrl:]]' or length(p_filename)>200 or p_mime not in ('application/pdf','image/jpeg','image/png') or p_size<=0 or p_size>10485760 then raise exception 'Comprovante inválido';end if;
 if p_replaces is not null then
  select * into current_attachment from public.financial_attachments where id=p_replaces for update;
  if current_attachment.id is null or not current_attachment.is_current or current_attachment.status<>'READY' or current_attachment.invoice_id is distinct from p_invoice or current_attachment.billing_record_id is distinct from p_record then raise exception 'Comprovante atual não encontrado';end if;
 end if;
 perform public.financial_operation(p_actor,'payment_proof',coalesce(p_invoice,p_record)::text);
 insert into public.financial_attachments(id,document_type,invoice_id,billing_record_id,storage_path,original_filename,mime_type,file_size,replaces_attachment_id)
 values(attachment_id,'PAYMENT_PROOF',p_invoice,p_record,format('payment-proofs/%s/%s',coalesce(p_invoice,p_record),attachment_id),p_filename,p_mime,p_size,p_replaces);
 return query select attachment_id,format('payment-proofs/%s/%s',coalesce(p_invoice,p_record),attachment_id);
end;$$;

create or replace function public.complete_financial_attachment(p_actor bigint,p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare attachment public.financial_attachments%rowtype;
begin
 select * into attachment from public.financial_attachments where id=p_id for update;
 if attachment.id is null or attachment.status<>'PENDING' or attachment.created_by<>p_actor then raise exception 'Envio não disponível';end if;
 if not public.authorized_financial_attachment_actor(p_actor,attachment.invoice_id,attachment.billing_record_id) then raise exception 'Acesso negado';end if;
 if attachment.invoice_id is not null and not exists(select 1 from public.invoices where id=attachment.invoice_id and status='ACTIVE' and voided_at is null and paid_at is not null) then raise exception 'Pagamento não está mais ativo';end if;
 if attachment.billing_record_id is not null and not exists(select 1 from public.billing_records where id=attachment.billing_record_id and payment_status='PAGO' and paid_at is not null) then raise exception 'Pagamento não está mais ativo';end if;
 perform public.financial_operation(p_actor,'payment_proof',coalesce(attachment.invoice_id,attachment.billing_record_id)::text);
 if attachment.replaces_attachment_id is not null then update public.financial_attachments set is_current=false,deactivated_at=clock_timestamp(),deactivation_reason='REPLACED',replaced_by_attachment_id=attachment.id where id=attachment.replaces_attachment_id and is_current;end if;
 update public.financial_attachments set status='READY',is_current=true where id=attachment.id;
end;$$;

create or replace function public.reject_financial_attachment(p_actor bigint,p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.financial_operation(p_actor,'payment_proof',p_id::text);
 update public.financial_attachments set status='REJECTED' where id=p_id and created_by=p_actor and status='PENDING';
 if not found then raise exception 'Envio não disponível';end if;
end;$$;

create or replace function public.deactivate_reversed_payment_proofs() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='billing_records' and old.payment_status='PAGO' and new.payment_status='PENDENTE' then
  update public.financial_attachments set is_current=false,deactivated_at=clock_timestamp(),deactivation_reason='PAYMENT_REVERSED' where billing_record_id=new.id and status='READY' and is_current;
 elsif tg_table_name='invoices' and old.paid_at is not null and new.paid_at is null then
  update public.financial_attachments set is_current=false,deactivated_at=clock_timestamp(),deactivation_reason='PAYMENT_REVERSED' where invoice_id=new.id and status='READY' and is_current;
 end if;
 return new;
end;$$;
create trigger deactivate_reversed_record_proofs after update of payment_status on public.billing_records for each row execute function public.deactivate_reversed_payment_proofs();
create trigger deactivate_reversed_invoice_proofs after update of paid_at on public.invoices for each row execute function public.deactivate_reversed_payment_proofs();

revoke all on function public.financial_attachment_snapshot(jsonb),public.financial_attachment_log_change(),public.authorized_financial_attachment_actor(bigint,uuid,uuid),public.begin_financial_attachment(bigint,uuid,uuid,text,text,bigint,uuid),public.complete_financial_attachment(bigint,uuid),public.reject_financial_attachment(bigint,uuid),public.deactivate_reversed_payment_proofs() from public,anon,authenticated;
grant execute on function public.financial_attachment_snapshot(jsonb),public.financial_attachment_log_change(),public.authorized_financial_attachment_actor(bigint,uuid,uuid),public.begin_financial_attachment(bigint,uuid,uuid,text,text,bigint,uuid),public.complete_financial_attachment(bigint,uuid),public.reject_financial_attachment(bigint,uuid),public.deactivate_reversed_payment_proofs() to service_role;
