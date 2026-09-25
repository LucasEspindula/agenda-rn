-- Read-only post-migration integrity checks. Legacy paid records without a
-- confirmed fiscal snapshot are intentionally retained for explicit review.
select 'duplicate_active_requests' check_name,count(*) failures from
 (select attendance_id from public.invoice_requests where status in ('PENDING','ISSUED') group by attendance_id having count(*)>1) x
union all select 'private_invoice_item_count',count(*) from public.invoices i where recipient_type='PARTICULAR' and (select count(*) from public.invoice_billing_records x where x.invoice_id=i.id)<>1
union all select 'issued_request_without_invoice',count(*) from public.invoice_requests r left join public.invoices i on i.id=r.invoice_id where r.status='ISSUED' and i.id is null
union all select 'pending_request_incompatible_payment',count(*) from public.invoice_requests r join public.billing_records b on b.id=r.billing_record_id where r.status='PENDING' and (b.payment_status<>'PAGO' or b.billing_method<>'PARTICULAR' or b.received_amount is distinct from r.received_amount_snapshot or b.paid_at is distinct from r.paid_at_snapshot)
union all select 'invoice_method_mismatch',count(*) from public.invoice_billing_records x join public.invoices i on i.id=x.invoice_id join public.billing_records b on b.id=x.billing_record_id where i.recipient_type<>b.billing_method;
select p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute,has_function_privilege('service_role',p.oid,'EXECUTE') service_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('save_billing','save_private_invoice','prepare_private_payment','finish_private_payment','check_fiscal_integrity','protect_invoice_request','valid_cpf');
select relrowsecurity from pg_class where oid='public.invoice_requests'::regclass;
