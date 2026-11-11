-- Valor do procedimento no agendamento.
-- A secretaria/gerência informa no agendamento; aparece no card da agenda e no PDF
-- (impressão e e-mail do médico). É dado da agenda, independente do faturamento (pausado).
alter table public.appointments add column if not exists procedure_value numeric(12,2)
  check (procedure_value is null or (procedure_value >= 0 and procedure_value <= 9999999.99));

-- As três funções que leem e gravam o agendamento passam a levar o campo "procedureValue".
-- Cada troca é conferida: se o texto esperado não existir, a migração para (nada é aplicado).
do $migration$
declare
  def text; patched text;
begin
  -- Leitura de um agendamento (agenda completa e sugestões).
  def := pg_get_functiondef('public.agenda_appointment_json(public.appointments)'::regprocedure);
  patched := replace(def, $s$'guideExpiry',coalesce(a.guide_expiry,''),$s$,
    $s$'guideExpiry',coalesce(a.guide_expiry,''),'procedureValue',a.procedure_value,$s$);
  if patched = def then raise exception 'agenda_appointment_json: trecho não encontrado'; end if;
  execute patched;

  -- Leitura da agenda por janela e incremental (duas montagens de agendamento).
  def := pg_get_functiondef('public.agenda_state_json(uuid,date,timestamptz)'::regprocedure);
  patched := replace(def, $s$'guideExpiry',coalesce(a.guide_expiry,''),$s$,
    $s$'guideExpiry',coalesce(a.guide_expiry,''),'procedureValue',a.procedure_value,$s$);
  if (length(patched) - length(def)) <> 2 * length($s$'procedureValue',a.procedure_value,$s$) then
    raise exception 'agenda_state_json: esperava 2 trechos'; end if;
  execute patched;

  -- Gravação (inserir e atualizar).
  def := pg_get_functiondef('public.apply_agenda_changes(bigint,jsonb,jsonb,text,text,text,jsonb)'::regprocedure);
  patched := replace(def, 'procedure,insurance,billing_method,guide_expiry,opme,',
    'procedure,insurance,billing_method,guide_expiry,procedure_value,opme,');
  patched := replace(patched, $s$nullif(d->>'forma_cobranca',''),d->>'guideExpiry',$s$,
    $s$nullif(d->>'forma_cobranca',''),d->>'guideExpiry',nullif(d->>'procedureValue','')::numeric(12,2),$s$);
  patched := replace(patched, $s$guide_expiry=d->>'guideExpiry',$s$,
    $s$guide_expiry=d->>'guideExpiry',procedure_value=nullif(d->>'procedureValue','')::numeric(12,2),$s$);
  if (length(patched) - length(def)) <> length('procedure_value,')
      + length($s$nullif(d->>'procedureValue','')::numeric(12,2),$s$)
      + length($s$procedure_value=nullif(d->>'procedureValue','')::numeric(12,2),$s$) then
    raise exception 'apply_agenda_changes: trechos não encontrados'; end if;
  execute patched;
end
$migration$;
