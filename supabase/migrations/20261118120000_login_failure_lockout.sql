-- Bloqueio de login por senha errada.
-- O app reserva a tentativa (consume_security_limit) antes de conferir a senha e a devolve
-- quando a senha está certa: os contadores de login passam a medir só as falhas, sem brecha
-- para várias tentativas simultâneas escaparem da contagem. A redefinição de senha zera o bloqueio.

create or replace function public.refund_security_limit(p_key text)
returns void
language sql
set search_path = ''
as $$
  update public.security_rate_limits
     set hits = greatest(hits - 1, 0)
   where key = p_key and expires_at >= clock_timestamp();
$$;

create or replace function public.clear_security_limit(p_key text)
returns void
language sql
set search_path = ''
as $$
  delete from public.security_rate_limits where key = p_key;
$$;

revoke all on function public.refund_security_limit(text) from public, anon, authenticated;
revoke all on function public.clear_security_limit(text) from public, anon, authenticated;
grant execute on function public.refund_security_limit(text) to service_role;
grant execute on function public.clear_security_limit(text) to service_role;
