-- Reduz a superficie publica de tres funcoes legadas.
-- As funcoes de trigger nao sao RPCs; o trigger permanece ativo.
-- A restauracao fiscal e autorizada apenas pela API servidora com service_role.
revoke execute on function public.restore_billing_invoice(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.restore_billing_invoice(bigint,jsonb) to service_role;
revoke execute on function public.guard_billing_monthly_closing_immutable() from public, anon, authenticated;
revoke execute on function public.log_monthly_financial_action() from public, anon, authenticated;
