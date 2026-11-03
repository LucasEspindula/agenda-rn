# Etapa A1 — Agenda normalizada (plano final)

> Lançamento interno, só RN Gestão. Agenda primeiro; o faturamento será refeito depois em branch e banco de desenvolvimento próprios. Fase 2B (multiempresa) pausada, guards de organização única mantidos.

## Decisões

- A agenda é dona de pacientes, consultas, bloqueios, regras, hospitais e configuração de expediente.
- A única porta para o faturamento é `attendances`, alimentada por `sync_financial_attendances` (agora por linha em `appointments`).
- O faturamento não grava em tabelas da agenda. A única leitura cruzada da agenda é a guarda de NF emitida antes de cancelar/arquivar consulta.
- Faturamento **desligado**: menus ocultos, rotas financeiras respondem `503 Faturamento em reconstrução` e as RPCs financeiras acopladas ao antigo `app_state` foram substituídas por stubs que levantam o mesmo erro (corpos originais preservados no histórico de migrations do Git).
- `app_state` fica congelado (sem leitura nem escrita pela aplicação; trigger rejeita qualquer escrita) até a etapa A2, que o remove.
- `legacy-app.js` só muda no cadastro de paciente (checkbox RN e campo Responsável).

## Modelo

Todas as tabelas: `organization_id` obrigatório, `UNIQUE(organization_id,id)`, FKs compostas, RLS ligado sem grants para `anon`/`authenticated`, `id text` com CHECK de UUID, `row_version`, `created_*`/`updated_*`, trigger `guard_agenda_organization` (RN Gestão, organização única, sem troca de organização).

| Tabela | Observações |
| --- | --- |
| `agenda_settings` | Uma linha por organização: expediente, timezone, `revision` global (só para polling/aviso). |
| `hospitals` | `archived_at`; ausência no envio = arquivamento explícito deduzido no servidor. |
| `patients` | `owner_professional_id` permanente (troca só sem consultas e sem histórico); `newborn`, `guardian_name` (obrigatório quando RN); CPF único por `(org, owner, cpf)` quando `cpf` não nulo e não RN; `archived_at`. Nunca removido por ausência. |
| `appointments` | Ativas e canceladas juntas (`cancelled_at`, `cancel_reason`, `cancelled_by`); `archived_at`; data + hora local (`date`, `time`) e timezone da organização; sem `payment`/`invoiceNumber`. Paciente deve pertencer ao cirurgião (ou ao anestesista quando não há cirurgião). Nunca removido por ausência. |
| `appointment_reschedules` | Append-only. |
| `patient_history_events` | Append-only e imutável. |
| `schedule_blocks` | Ausência no envio = exclusão explícita deduzida, limitada ao que o ator edita, auditada. |
| `scheduling_rules` | `preferred_times`/`forbidden_times` como `time[]` validados; ausência = exclusão explícita deduzida. |
| `agenda_row_versions` | Versão de cada linha (forma legada) com a `revision` em que foi gravada; base para o merge de três vias. |

## Concorrência por registro

O cliente legado envia o estado inteiro com `If-Match: <revision>`. O servidor:

1. compara cada linha enviada com a linha atual; iguais são ignoradas;
2. para as diferentes, busca a versão da linha vigente na `revision` do cliente (`agenda_row_versions`); se a linha enviada é igual a essa base, o usuário não a alterou (cópia antiga) e ela é ignorada;
3. se o usuário alterou a linha e outra pessoa também (versão atual ≠ versão base), responde 409;
4. senão aplica a operação com `expected_row_version` — a RPC recusa (409) se a linha mudou entre a leitura e a escrita.

Duas pessoas editando registros diferentes não se bloqueiam. A `revision` global só sinaliza atualização para o polling.

## RPCs (`SECURITY INVOKER`, `EXECUTE` só `service_role`)

- `load_agenda_state(p_actor bigint) → jsonb {state, revision}` — JSON no formato legado (schemaVersion 7).
- `agenda_revision(p_actor bigint) → timestamptz`.
- `agenda_row_bases(p_actor bigint, p_revision timestamptz, p_keys jsonb) → jsonb` — versões-base para o merge.
- `apply_agenda_changes(p_actor bigint, p_ops jsonb, p_audit jsonb, p_request_id text, p_decision text, p_note text, p_notification jsonb) → jsonb {ok, revision, conflict}` — única escrita; operações: `upsert_patient`, `archive_patient`, `upsert_appointment`, `archive_appointment`, `append_history`, `upsert_block`, `delete_block`, `upsert_rule`, `delete_rule`, `upsert_hospital`, `archive_hospital`, `save_settings`.
- `commit_agenda_change` passa a falhar com "Agenda migrada; atualize a página" (bloqueia código antigo).

## Triggers por linha

Disponibilidade (bloqueios, regras, expediente, limite diário, horários proibidos/permitidos), guarda de NF emitida, autoria de paciente, snapshot de convênio, validação de médicos/agenda ativa (ex-`project_central_doctors`), `sync_financial_attendances`, guard de organização, imutabilidade de histórico/remarcações, dono do paciente, versões de linha e `revision` global.

`app_state`: triggers antigos removidos; ficam `guard_legacy_agenda_organization` e o congelamento.

## Ordem de aplicação

1. Implementação local; `npm run build && npm test`, `npm run lint`, `npx tsc --noEmit` verdes.
2. Migration executada no banco real dentro de `BEGIN … ROLLBACK`; verificação de qual Supabase os previews da Vercel usam. **Pausa para aprovação.**
3. Aplicação da migration e confirmação por `list_migrations` e catálogo.
4. Contas de teste, verificação no navegador (desktop e mobile).
5. Push único (squash), PR, CI verde. **Pausa antes do merge.**
6. Merge, deploy READY, atualização do CONTEXTO com evidências.

## Plano de testes

Contrato por perfil (gerente/secretária/médico), concorrência por registro, RN/CPF, soft delete e fim do apagar por omissão, disponibilidade, guarda de NF emitida, congelamento do `app_state`, contrato das rotas sem `app_state`, faturamento desligado.

## Testes do faturamento em skip temporário

**Nenhum teste precisou de skip.** Os testes de comportamento do faturamento (`navigation`, `next-stage-access`, `refinement`, `billing-api`) continuam rodando com `BILLING_PAUSED=false` injetado por mock (`'./billing-paused'`), preservando o contrato para a reconstrução; `agenda-billing-paused.test.mjs` cobre o estado desligado. Testes adaptados ao novo store: `state-sync` (reescrito), `documents`, `attendance-password-status`, `agenda-sync`, `agenda-organization-scope`, `agenda-pdf-service-access`, `issued-invoice-attendance-protection`, `financial-logs-tenant-organization`.

Na reconstrução do faturamento: remover `BILLING_PAUSED`, restaurar as RPCs financeiras (corpos nas migrations anteriores) lendo `patients`/`appointments`, e retirar os mocks de `'./billing-paused'`.

## Limitações conhecidas

- Painéis financeiros dentro do detalhe da consulta ficam ocultos por CSS (`body.billing-paused`); chamadas residuais a `/api/billing` recebem 503.
- Hospitais arquivados deixam de aparecer na lista; consultas antigas que os referenciam mostram o hospital em branco.
- Consultas só com anestesista exigem paciente cadastrado na agenda do anestesista.
- Troca do médico responsável: bloqueada se houver consulta (inclusive cancelada) ou evento de histórico ligado a consulta; eventos cadastrais (ex.: "Paciente cadastrado") não bloqueiam a correção.
