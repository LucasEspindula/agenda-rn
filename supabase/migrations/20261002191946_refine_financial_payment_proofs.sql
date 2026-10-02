-- Keep SQL authorization aligned with the authorized Agenda scope used by the API.
-- A shared invoice remains operable only when the secretary can access every item.
create or replace function public.authorized_financial_attachment_actor(actor bigint,invoice uuid,record uuid)
returns boolean
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_role text;
begin
  select role into v_role from public.users where id=actor;
  if v_role='general_manager' then return true; end if;
  if v_role<>'secretary' then return false; end if;

  if record is not null then
    return exists(
      select 1
      from public.billing_records b
      join public.attendances a on a.id=b.attendance_id
      join public.agenda_access g on g.user_id=actor
        and (g.professional_id=a.doctor_id or g.professional_id=a.anesthetist_id)
      where b.id=record
    );
  end if;

  return exists(select 1 from public.invoice_billing_records ib where ib.invoice_id=invoice)
    and not exists(
      select 1
      from public.invoice_billing_records ib
      join public.billing_records b on b.id=ib.billing_record_id
      join public.attendances a on a.id=b.attendance_id
      where ib.invoice_id=invoice
        and not exists(
          select 1 from public.agenda_access g
          where g.user_id=actor
            and (g.professional_id=a.doctor_id or g.professional_id=a.anesthetist_id)
        )
    );
end;
$$;

revoke all on function public.authorized_financial_attachment_actor(bigint,uuid,uuid) from public,anon,authenticated;
grant execute on function public.authorized_financial_attachment_actor(bigint,uuid,uuid) to service_role;
