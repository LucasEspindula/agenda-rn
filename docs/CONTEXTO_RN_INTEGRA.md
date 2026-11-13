# RN Integra — Contexto central e continuidade

> Atualizado em 09/11/2026 (America/Sao_Paulo); estado atual na seção 6B. Documento de transferência entre conversas de desenvolvimento. **Não substitui verificações ao vivo no GitHub, Supabase e Vercel.**

## 1. Como retomar o trabalho em um novo chat

1. Ler este arquivo inteiro.
2. Inspecionar o `main` e as PRs recentes do repositório `rn-integra/agenda-rn`; não pressupor que o SHA deste snapshot ainda seja o atual.
3. Consultar migrações e estado do Supabase de produção `nagddicinjszfrtwgjbu`, e confirmar o deploy em produção do projeto Vercel `agenda-rn`.
4. Comparar **código + banco + deploy**, diferenciando *proposto*, *mergeado*, *migração aplicada* e *publicado*.
5. Antes de continuar uma fase, ler suas notas de arquitetura e auditar a implementação anterior. Alterações financeiras, RLS, autorização e migrações exigem testes e revisão cuidadosa.
6. Ao concluir uma etapa, atualizar neste arquivo: data, PR, SHA, migração, testes, deploy, pendências e próxima ação. Nunca registrar um teste ou publicação sem evidência.
7. Evitar segredos, dados de pacientes, chaves e credenciais nesta documentação. Não alterar banco de produção apenas para sincronizar contexto.

## 2. Identificação e infraestrutura

- Produto: **RN Integra** (nome vigente em toda a interface; antigo Agenda RN).
- Repositório público: `rn-integra/agenda-rn` (organização da empresa desde 13/11/2026); branch principal: `main`.
- Supabase produção: `nagddicinjszfrtwgjbu`; Supabase dos previews: `funqdoiubwskmhefbvjz` ("Agenda RN Preview", desde 11/11/2026; o antigo `vmpvngjppnouqfzahezr` foi apagado).
- Vercel: projeto `agenda-rn` (`prj_XiOYwxCOguNmorHg30FRF3M9lER5`); time "RN Integra" `team_ZzwM8ykcrLvRvCvL7BXvMgRB` (desde 13/11/2026, ainda Hobby). Supabase: organização "RN Integra" `xtnswwghfqggqesrkqnx`.
- Objetivo: evoluir o sistema existente para SaaS multiempresa comercializável, **sem expor dados entre organizações**.
- Estratégia: preservar estabilidade e compatibilidade do cliente existente (RN Gestão), migrar gradualmente, sem criar novos tenants até concluir o isolamento.
- **Desde 06/11/2026:** lançamento para outras clínicas decidido; multiempresa implementado (seção 6B). Banco de produção só tem dados de teste e será zerado antes do lançamento.

## 3. Snapshot verificado em 29/10/2026

| Item | Estado e evidência |
| --- | --- |
| `main` na verificação | `353de1ef7a1abf8fd0ff3b9dbb1475b3648a480b` |
| PR #69 — Etapa 2A | **Mergeada**; lifecycle de acesso e vínculos RN Gestão, commit `55be362596ba47f01d2acd582bbe0da8d63ad7e1` |
| PR #70 — Etapa 2B/1 | **Mergeada em 29/10 às 18:46 UTC**; vínculo inicial de agenda à organização, merge commit `353de1ef7a1abf8fd0ff3b9dbb1475b3648a480b` |
| Supabase produção | Projeto `ACTIVE_HEALTHY`; versões `20261029181434 organization_access_lifecycle` e `20261029184300 agenda_organization_scope` aparecem no histórico aplicado |
| Vercel produção | Deployment `dpl_8Zkc2VKSfED18vD2FMgso5EoDeeh` em **READY**, ligado ao mesmo SHA `353de1ef...` |
| Testes | Relato da etapa anterior: **515 testes aprovados**; não reexecutados durante esta atualização documental |
| Multiempresa | **Ainda não habilitado para novos clientes**: PR #70 informa bloqueio físico temporário enquanto outras 12 funções legadas dependem de `app_state.id=1` |

Fontes: [PR #69](https://github.com/LucasEspindula/agenda-rn/pull/69), [PR #70](https://github.com/LucasEspindula/agenda-rn/pull/70), [commit #70](https://github.com/LucasEspindula/agenda-rn/commit/353de1ef7a1abf8fd0ff3b9dbb1475b3648a480b).

### Escopo exato da Etapa 2B/1

- FK de organização obrigatória e única no documento legado `app_state`, com backfill para RN Gestão sem alteração do payload/revision/version.
- Consultas na API e faturamento vinculadas à organização RN Gestão; tenant não é selecionado pelo navegador.
- Gravação principal exige usuário e vínculo ativos, preservando transação, disponibilidade, NF, auditoria e triggers existentes.
- **Restrição importante:** não interpretar a PR como isolamento integral de todos os caminhos legados.

## 4. Regras e decisões de produto que devem ser preservadas

### Agenda, atendimento e autorização

- Agenda/atendimento é fonte da verdade para data, procedimento, convênio e status; faturamento referencia atendimento, evitando duplicações.
- Paciente é entidade única; seleção de convênio é independente da `forma_cobranca` (PARTICULAR ou CONVENIO).
- Bloqueios por empresa e período valem no desktop, mobile **e backend**; dia totalmente indisponível mostra bloco explicativo no mobile.
- Não cancelar agendamento nem excluir/cancelar atendimento associado a NF **EMITIDA**; regra também no backend.
- Status da nota fiscal deve aparecer em coluna separada do status do atendimento.

### Faturamento e notas fiscais

- `status_pagamento` extensível, inicialmente PENDENTE/PAGO.
- Para cobrança CONVENIO, `valor_recebido` individual é **NULL**, não zero; pagamento consolidado pertence à NF/lote. Para PARTICULAR, valores e datas podem ser individuais.
- Não eliminar imediatamente valores digitados ao alternar temporariamente a forma de cobrança na edição; decidir persistência no salvamento.
- Entidade recebedora PF/PJ é independente do médico e possui histórico de vínculos; o faturamento registra `entidade_recebedora_id` para preservar histórico.
- Uma NF pode associar vários atendimentos por itens; relação de NFs deve ser distinta do relatório mensal médico.
- Módulo Faturamento concentra relações fiscais, pendências por convênio, glosas e fechamento mensal; manter regras de permissão e auditoria.
- Solicitação de NF: remover redundância do rótulo “Pago em”, disponibilizar ação no `+` mobile e botão dedicado no desktop.
- Relatórios/PDFs devem preservar visibilidade por perfil; não exibir valores financeiros a médicos quando vedado.

### Interface e planejamento

- Usar o nome **RN Integra**.
- Hub administrativo inicial exclusivo de Gerente Geral, com Agendamento e Faturamento.
- Página “Início” da agenda permanece **sem definição aprovada**: não tratar ideias antigas como requisitos fechados.
- Auditoria geral de prontidão comercial está planejada, mas só ocorrerá quando solicitada.

## 5. Histórico de decisões e riscos recentes

- Evolução multiempresa com abordagem aditiva e compatível; não migrar de Supabase por antecipação.
- Custos previstos em discussão anterior: Supabase Pro US$25/mês e Vercel Pro US$20/mês como referência inicial, sujeitos a uso e preços atuais; não presumir que custo permaneça fixo.
- O código experimental do **Perseu** foi retirado do repositório em 28/10 (commit `9c4c058...`) segundo histórico GitHub. Documentos mais antigos podem descrevê-lo como ativo: **prevalece o estado atual do código**, sem reintroduzir automaticamente funcionalidades removidas.
- Há histórico de problemas de alinhamento entre migrações aplicadas e arquivos versionados. Sempre confrontar as versões e não repetir migrations aplicadas.

## 6. Etapa 2B/2 — isolamento progressivo em execução

**Prioridade:** concluir o isolamento progressivo. A Etapa 2B/2a migrou duas funções SQL para escopo por organização; a próxima 2B/2b abrange dez funções financeiras ainda com referências a `app_state.id=1`, além de tabelas, APIs e anexos globais. Conferir o inventário na [issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72).

Critérios mínimos para avanço:
- Organização derivada da autenticação/vínculo validado no servidor, nunca de parâmetro arbitrário do cliente.
- Isolamento em todas as APIs, relatórios, anexos, histórico, faturamento, agendamentos e funções SQL relevantes.
- Testes de acesso cruzado entre duas organizações e de regressão RN Gestão; logs/auditoria isolados.
- Migrations aditivas, plano de rollback, CI, revisão de PR e confirmação do deploy em produção.
- **Não criar ou liberar clientes adicionais antes de fechar esses critérios.**

**Estado verificado (29/10/2026):** a 2B/2a foi integrada pela PR #71 no commit `639c2b22d6c6098ff50996b73167f4489c691284`. Migração `20261029192723 legacy_agenda_directory_org_scope` registrada no Supabase; validação dos privilégios de execução e predicados organizacionais concluída; GitHub Actions **521/521 testes, 0 falhas**, lint e tipos aprovados. Deploy funcional de produção **READY** na Vercel, `dpl_F2XUGL59JRhofsYYFmj8ohwi49dN`, associado ao commit `639c2b22...` da PR #71; os commits documentais posteriores geram novos deployments automáticos e devem ser avaliados em separado. O onboarding de novos tenants continua **bloqueado**.


### Atualização de continuidade — 2B/2a (mergeada, 29/10/2026)

- Branch: `feat/rn-organization-agenda-legacy-2b2a-20261029`; PR #71 **mergeada** em `main`, commit `639c2b22d6c6098ff50996b73167f4489c691284`.
- Escopo concluído: validação de vínculo RN Gestão no banco e operações de cadastro médico/agenda e atendimento manual por `app_state.organization_id`.
- Migração **aplicada e conferida** no Supabase: `20261029192723 legacy_agenda_directory_org_scope`. O último commit da PR passou **521/521 testes**, lint, tipos e build, com deploy funcional Vercel `dpl_F2XUGL59JRhofsYYFmj8ohwi49dN` em READY.
- A PR #71 foi integrada e publicada. Revisões completas de outros domínios permanecem nas etapas posteriores de isolamento multiempresa.
- Restam as demais funções legadas e o isolamento das tabelas, APIs, anexos, relatórios e RLS. Novos tenants continuam proibidos.


### Etapa 2B/2b1 — fundação física financeira (concluída e publicada em 29/10/2026)

- PR [#73](https://github.com/LucasEspindula/agenda-rn/pull/73) **mergeada** na `main`, commit `86c7cf901fcc1df10a66f6f81c131e55944b26bc`.
- Migração **aplicada e verificada**: `20261029194356_financial_tenant_keys_foundation.sql`, Supabase `20261029194356 financial_tenant_keys_foundation`; consulta de catálogo confirmou 9 colunas obrigatórias, 20 FKs compostas, 9 triggers, 9 índices compostos e RLS ativo nas 9 tabelas.
- Nove tabelas do núcleo financeiro recebem `organization_id`, chaves e 20 FKs compostas para prevenir referências cruzadas; RLS e privilégios existentes são mantidos. O default é temporário, derivado exclusivamente da organização RN Gestão e rejeita uma segunda organização.
- Testes novos: `tests/financial-tenant-keys-foundation.test.mjs`, incluindo backfill, bloqueio de transferências, vínculos entre organizações e comportamento de cascata das NFs.
- Validações finais: CI do último commit da PR com **528/528 testes aprovados, zero falhas**, lint, tipos e build aprovados. Migração PostgreSQL aplicada/verificada; **20 FKs validadas**, 9 FKs de organização validadas, nenhuma leitura direta das 9 tabelas para `anon`/`authenticated`. Vercel produção **READY**: deployment `dpl_7vsZbHHjTdjaHa36MGwNnnUatQV2`, commit `86c7cf9...`. Nenhum registro de teste precisou ser excluído.
- Depois: dez funções SQL legadas, demais tabelas, APIs com service_role, relatórios, Storage e testes end-to-end de duas empresas. Consultar [issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72).
- Dados atuais são de teste e registros pontualmente problemáticos podem ser descartados com registro técnico; nunca desabilitar as restrições de isolamento em produção para contornar os testes.



### Etapa 2B/2b2a — proteção de comprovantes financeiros (integrada e publicada em 29/10/2026)

- PR [#74](https://github.com/LucasEspindula/agenda-rn/pull/74) **mergeada** em `main`, commit `cc7cc5b18eb63886edd02d0ee01d4248dfd3bb2b`.
- Migração **aplicada e conferida** `20261029200153_financial_attachment_organization_authorization.sql` (Supabase `20261029200153 financial_attachment_organization_authorization`); catálogo comprovou escopo de organização, nova estrutura de caminhos e privilégios restritos. A migration endurece `authorized_financial_attachment_actor` com vínculo de organização e alvo existente; substitui dois acessos globais a `app_state.id=1` por `organization_id`; autoriza todos os itens de uma NF para secretárias; atualiza `begin_financial_attachment` para criar novos Storage paths `org/<organization-uuid>/payment-proofs/<target-uuid>/<attachment-uuid>`.
- Leituras de metadados em `app/api/financial-attachments/route.ts` filtram a organização RN Gestão ativa antes de gerar URLs assinadas. Arquivos legados continuam em seus caminhos originais (não são migrados nem apagados).
- Testes PGlite em `tests/financial-attachment-organization.test.mjs` cobrem autorizações, vínculos desativados, nota compartilhada, acesso do anestesista, ausência de alvo, segundo tenant bloqueado e namespace de Storage.
- **Fechamento validado:** CI do commit reconciliado **533/533 testes, zero falhas**; build, lint e TypeScript aprovados. Supabase migração `20261029200153` aplicada, função `SECURITY INVOKER`, execução `anon`/`authenticated` negada; Vercel produção `dpl_HegVbow8mWUckkXDntW4wzogPwBq` em **READY** para o commit da PR #74. Nenhum registro de teste precisou ser excluído. Restam outras funções/rotas e o onboarding de segunda organização continua bloqueado.


### 2B/2b2b-1 — quatro RPCs financeiras (concluída e publicada em 29/10/2026)

- PR [#75](https://github.com/LucasEspindula/agenda-rn/pull/75) **mergeada** na `main`, commit `41fdce6ec22e67881e03c78c8a5dc0149a3e29f1`. Migração `20261029202018 financial_legacy_rpcs_org_scope` aplicada e conferida no Supabase. CI do último commit **540/540 testes**, lint, tipos e build aprovados. Vercel produção **READY**: `dpl_H6RHehFWAnuod72Df9njc3XbRj8Z`.
- Quatro funções: `attribute_financial_attendance`, `financial_log_snapshot`, `finish_private_payment`, `update_pending_invoice_request`. Removem leituras da agenda por `id=1`, validam `organization_id` nas operações e mantêm bloqueio de segundo tenant.
- Testes em `tests/financial-legacy-rpcs-organization.test.mjs`; nenhuma operação de exclusão de dados.
- **Estado confirmado:** as quatro funções usam escopo de organização, permanecem `SECURITY INVOKER` e só aceitam execução direta de `service_role`; não restam referências `app_state.id=1` nessas quatro rotinas. Teste de leitura em PostgreSQL real passou. Nenhum registro de teste foi excluído. Próxima fatia: cinco RPCs fiscais/cobranças restantes, além de APIs, Storage e tabelas auxiliares. Manter bloqueio de novas empresas; ver [issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72).


### 2B/2b2b-2 — Cinco RPCs financeiras (publicada em 29/10/2026)

- Migration **aplicada e verificada**: `20261029203540_financial_five_legacy_rpc_org_scope.sql`; Supabase versão `20261029203540`. Catálogo confirmou 5 funções com validação de membership, sem predicados globais da agenda, `SECURITY INVOKER` e execução direta negada a `anon`/`authenticated`. CI final **546/546 testes aprovados**, lint/tipos/build aprovados. PR [#76](https://github.com/LucasEspindula/agenda-rn/pull/76) mergeada no commit `770f0f2516113d6e4f0ba9b73fcf48d1e9aa193b`; Vercel produção **READY** (`dpl_GNwCahtRKdzhPVfWVHXswJHrWGnY`).
- Funções: `save_professional_charge`, `save_professional_charge_core`, `save_billing_legacy_single_charge`, `save_billing_fiscal_core`, `preview_billing_month`.
- Contexto de organização vem de `require_rn_agenda_actor_organization(p_actor)`, sem `app_state.id=1`. Testes em `tests/remaining-financial-org-rpcs.test.mjs`.
- **Conclusão verificada:** as cinco RPCs foram publicadas e não restam referências a `app_state.id=1` em funções financeiras; `commit_agenda_change` mantém esse ID apenas com validação de organização por compatibilidade. Nenhum registro de teste foi excluído. Próxima fase: tabelas auxiliares, APIs `service_role`, Storage, relatórios e testes de separação entre organizações. O onboarding multiempresa segue bloqueado.


### Etapa 2B/3a — chaves de organização em pagamentos e envios ao portal (concluída e publicada em 29/10/2026)

- Branch `feat/rn-financial-child-tenant-keys-2b3a`.
- Migração **aplicada e validada**: `20261029205127_finance_auxiliary_tenant_keys.sql`. Confirmados 3 colunas obrigatórias, 4 FKs compostas validadas, 3 triggers e RLS ativo. Dez parcelas existentes vinculadas à RN Gestão, nenhuma excluída. CI do commit final **552/552 testes aprovados, zero falhas**, lint, tipos e build aprovados. PR [#77](https://github.com/LucasEspindula/agenda-rn/pull/77) mergeada em `5d3426f6dbe7f23a64cdd502e090dfd2a6490a07`; Vercel produção **READY** (`dpl_FP4trqrWf5vNZc5mZjXbcQg7Se7L`).
- Adiciona `organization_id` a `payment_parts`, `billing_portal_submissions` e `billing_portal_submission_events`, com três FKs para organização, quatro FKs compostas para vínculos com o mesmo tenant, índices únicos e trigger existente de bloqueio de outras organizações.
- Preserva RLS e a compatibilidade com RN Gestão, inclusive os registros de teste existentes; não faz UPDATE em massa, evitando triggers de auditoria/pagamentos.
- Testes PGlite: preenchimento de registros anteriores, escrita default, second-tenant fail-closed, FKs cruzadas e privilégios.
- **Continua incompleto para SaaS multiempresa**: pendem tabelas auxiliares de glosas/despesas/fechamento, autorizações das APIs de `service_role`, Storage e ensaios com duas organizações. Não habilitar novos clientes.


### Etapa 2B/3b — glosas, despesas e fechamento por organização (publicada em 30/10/2026)

- [PR #78](https://github.com/LucasEspindula/agenda-rn/pull/78) **mergeada** na `main`, commit `2b4e497b0ba0415b7c8988f25048edb187fa1c53`.
- Migração **aplicada e validada**: `20261030112459_financial_support_tenant_keys.sql` no Supabase. Catálogo confirmou 8 colunas obrigatórias, 13 FKs compostas, 8 FKs da organização, 8 triggers e RLS ativo. A despesa de teste foi preservada. CI final **559/559 testes**, zero falhas; lint, tipos e build aprovados. Deploy funcional Vercel produção **READY**: `dpl_Hxz3umYMEVcHXzQ13MS317qkm3g4`.
- Oito tabelas de glosas, recursos, recuperações, fechamentos, sócios e despesas recebem `organization_id` obrigatório, FK da organização, índice composto e trigger de bloqueio. Adiciona **13 FKs compostas** para impedir referências entre organizações.
- Dados de teste no início: glosas e fechamentos vazios, 1 despesa, 0 inconsistências detectadas; nenhuma exclusão necessária. O backfill evita UPDATE em massa para não executar triggers de histórico, fechamento imutável e auditoria.
- Testes PGlite em `tests/financial-support-tenant-keys.test.mjs`: backfill, RLS, vínculo cruzado, novas inserções, prevenção de segunda empresa e privilégios.
- **Auditoria preliminar das APIs:** `app/api/billing/denials/route.ts`, `app/api/billing/closing/route.ts` e `app/api/billing/logs/route.ts` ainda têm consultas amplas com `getSupabaseAdmin()`; o isolamento por `organization_id` de rotas e RPCs correspondentes precisa ser demonstrado antes de permitir novos tenants. Esta PR NÃO habilita multiempresa.
- **Publicação concluída:** 8 tabelas escopadas, 13 FKs compostas validadas e despesa de teste preservada sem exclusões. **Próximo bloqueador 2B/3c:** validar membership e escopo de organização em `save_billing_denial`, `save_billing_portal_submission`, `get_billing_month_closing`, `close_billing_month`, `unlock_billing_month`, além das APIs privilegiadas. Nenhum novo tenant liberado; ver [issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72).


### Etapa 2B/3c1 — autorização de glosas e submissões por organização (publicada em 30/10/2026)

- [PR #79](https://github.com/LucasEspindula/agenda-rn/pull/79) **mergeada** na `main`, commit `6ffbcc461f706e1cd6d975d45bf1cb73608401e0`. Migração `20261030115731 denial_portal_org_rpc_scope` aplicada e validada no Supabase. CI final **566/566 testes**, zero falhas; lint, tipos e build aprovados. Vercel produção **READY** no deploy `dpl_GfF8WVZbFo6zDgNHjCQ9G5AwGMMQ`.
- RPCs `save_billing_denial` e `save_billing_portal_submission` agora exigem vínculo ativo de organização do ator em `require_rn_agenda_actor_organization` e restringem consultas/atualizações ao `organization_id` validado no servidor.
- As APIs `app/api/billing/denials/route.ts` e `app/api/billing/portal/route.ts` fazem segunda verificação da organização no backend; leituras financeiras auxiliares (glosas e submissões) filtram `organization_id` e escritas das secretárias só aceitam registros do tenant.
- Testes `tests/denials-portal-organization-rpcs.test.mjs` cobrem manager, secretárias autorizadas/negadas, vínculo revogado, segundo tenant bloqueado, cobrança de outro tenant, grants e rotas.
- **Limites:** `loadBillingData` ainda usa consultas financeiras amplas sob gate singleton; as regras globais `billing_portal_deadline_rules`, fechamento mensal, logs, exportações e Storage ainda precisam de análise. Não autoriza onboarding multiempresa.
- **Publicação confirmada:** as duas RPCs têm membership ativo e escopo por organização no PostgreSQL, `SECURITY INVOKER` e EXECUTE público negado; as duas APIs reforçam o escopo. Nenhum registro de teste foi excluído. **Próxima fatia 2B/3c2:** três RPCs de fechamento mensal, regras de prazo do portal, logs e APIs com `service_role`. Multiempresa segue bloqueado; consultar [issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72).


### 2B/3c2 — fechamento mensal e regras de prazo do portal por organização (concluída e publicada em 30/10/2026)

- [PR #80](https://github.com/LucasEspindula/agenda-rn/pull/80) **mergeada**, commit `6cdf28ee5e12a580bd56a3293da3facd1a875ec7`. Migração `20261030123323 monthly_close_portal_rules_org_scope` aplicada e verificada no Supabase. Quatro RPCs com membership e escopo do tenant, EXECUTE apenas por `service_role`; regra de prazo com organização obrigatória, 2 FKs, trigger e RLS. CI final **574/574 testes**, zero falhas, lint/tipos/build aprovados. Vercel produção **READY** (`dpl_CwBCQ2NnXcx3d2mdhnpxwS6KoXb6`).
- RPCs `get_billing_month_closing`, `close_billing_month`, `unlock_billing_month` e `save_billing_portal_rule`: todas usam vínculo ativo do ator em `require_rn_agenda_actor_organization`, gerência obrigatória e consultas/alterações de organização.
- `billing_portal_deadline_rules` recebe `organization_id` obrigatório, FK de organização, FK composta profissional+organização, índices e trigger do tenant único. Sem exclusões ou UPDATE histórico. Regras atuais: 0; fechamentos e eventos atuais: 0.
- APIs `billing/closing`, `reports/monthly-closing/print` e `billing/portal` validam organização no servidor e filtram as listas de fechamentos/regras.
- Testes PGlite em `tests/monthly-close-portal-rules-organization.test.mjs`: fechamento, histórico, desbloqueio, regras de prazo, papéis, membership revogado, entidade/profissional de fora e segundo tenant.
- **Publicada e verificada:** não houve exclusão de dados nem alteração do cálculo financeiro. **Próxima etapa 2B/3d:** `loadBillingData`, logs e relatórios com `service_role`, auditoria e Storage. Onboarding multiempresa continua bloqueado até validação cross-tenant; ver [issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72).


### Etapa 2B/3d1 — carregamento financeiro e auditoria imutável por organização (mergeada; deploy pendente de comprovação — superado em 03/11: código publicado via `bf524cff`)

- Branch `feat/rn-billing-logs-tenant-scope-2b3d1`.
- `lib/billing-data.ts`: `loadBillingData(actorId)` exige organização ativa do ator no banco ANTES de consultar qualquer tabela; todas as tabelas financeiras agora recebem filtro `organization_id`, inclusive `app_state`. `users` é consultada via vínculo `organization_memberships` da organização atual, sem varredura global. As 6 APIs consumidoras passam o ator autenticado explicitamente.
- `app/api/billing/logs/route.ts` valida organização do gerente e filtra `financial_logs.organization_id` antes de retornar auditoria; embed histórico usa FK explícita para evitar ambiguidade com a FK composta.
- Migração **aplicada e validada no Supabase** `20261030130708_financial_logs_tenant_scope.sql`: `financial_logs` e `financial_log_changes` recebem organização obrigatória, duas FKs para organização, FK composta log/organização, índices e triggers do guard RN Gestão-only. Não usa UPDATE e preserva triggers de imutabilidade; original de 43 logs e 93 mudanças de teste preservado integralmente. Catálogo confirmou 2 colunas NOT NULL, 3 FKs validadas, 2 guards, 2 triggers imutáveis, RLS e nenhum grant público. CI inicial **580/580 testes** aprovado.
- Testes PGlite `tests/financial-logs-tenant-organization.test.mjs` cobrem histórico, append-only, segundo tenant, FK composta, grants e contratos de APIs.
- **Ainda não libera multiempresa:** faltam demais endpoints service_role (`billing/approvers`, `billing/doctor-entities`, `billing/entity-analytics`, relatórios, exportações), Storage e testes controlados com duas organizações. Ver issue #72.
- **Banco migrado, PR #81 mergeada:** commit `e232ae9ce183a60ede6580328bd5e4e76555d74c`, 580 testes registrados. Em 30/10 a consulta à Vercel retornou como deployment READY mais recente o commit `0e11e8a...` (anterior à PR #81). A publicação exata do commit #81 ainda precisa ser comprovada; não tratar como READY sem evidência. Não habilitar novos tenants.

### Etapa 2B/3d2 — isolamento inicial de APIs financeiras privilegiadas (PR #82 mergeada, publicação bloqueada)

- Branch `feat/rn-finance-api-tenant-scope-2b3d2`; PR [#82](https://github.com/LucasEspindula/agenda-rn/pull/82) mergeada em 30/10/2026, commit `35a3a32ebb338705eff8f99b0e1c18380e4f531f`.
- `billing/approvers`: verifica organização ativa via `financialActorOrganizationId` e lista gerentes apenas por `organization_memberships` da organização autenticada.
- `billing/doctor-entities`: valida organização ativa e restringe entidades e vínculos por `organization_id`.
- `billing/entity-analytics`: valida organização ativa e a propriedade da entidade solicitada antes de executar a RPC de indicadores. Definição da RPC foi inspecionada em modo leitura no Supabase; a consulta agrega valores por `billing_entity_id`.
- Contratos estáticos de proteção adicionados em `tests/financial-privileged-api-tenant-scope.test.mjs`. CI final `41073775407` **aprovada**: lint, testes, tipos/dependências e build. O teste legado de doctor-entities foi atualizado para simular a validação da organização; 1ª CI falhou 1/586, correção aprovada na 2ª CI. Preview Vercel do head `8f6f112f...` **READY** (`dpl_55EVPvmMz2m1WTwyR4JUeMgjSkU5`).
- **Publicação em produção bloqueada:** em 30/10 a tentativa de criar deployment Git da `main` no commit merge `35a3a32...` retornou HTTP 402, limite `api-deployments-free-per-day` (100+; retry indicado em 24h). Não afirmar que PR #82 está publicada; Vercel não confirmou deployment da PR #81. Requer liberação de cota/faturamento ou nova janela antes de confirmar READY. Nenhuma alteração feita no banco.
- **Não concluído:** auditoria de relatórios/exportações, Storage, demais rotas `service_role`, ensaios controlados com dois tenants, homologação e publicação; manter onboarding multiempresa bloqueado.

## 6A. Mudança de rumo — "Agenda primeiro" e etapa A1 (03/11/2026)

**Deploy confirmado antes da A1:** produção Vercel `dpl_C5JdvJhovGgrcMgY3fV3QEMkJHAR` **READY** no commit `bf524cff40284eadf5b6566274f2e6cace28f0fa` (main). Como `bf524cff` é posterior aos merges das PRs #81 e #82, **o código das duas está publicado**; o bloqueio HTTP 402 registrado em 30/10 foi superado.

**Decisões vigentes:**
- Lançamento **interno**, só RN Gestão. **Agenda primeiro**; o faturamento será refeito depois em branch e banco Supabase de desenvolvimento próprios.
- **Fase 2B (multiempresa) pausada**; guards de organização única mantidos. Tabelas novas nascem com `organization_id`.
- **Separação agenda × faturamento:** a agenda é dona de pacientes, consultas, bloqueios, regras e hospitais. A única porta para o faturamento é `attendances` (`sync_appointment_attendance`, por linha). O faturamento não grava em tabelas da agenda. Única leitura cruzada: guarda de NF emitida antes de cancelar/arquivar consulta.
- **Faturamento desligado** até a reconstrução: menus ocultos (`lib/billing-paused.ts`), rotas e páginas financeiras respondem 503 "Faturamento em reconstrução." (`proxy.ts`) e as RPCs financeiras acopladas ao antigo `app_state` viraram stubs com o mesmo erro.
- Todos os dados atuais são de teste.

**Etapa A1 — agenda normalizada (corte direto).** Concluída; o plano original fica no histórico do git.
- Migration **aplicada** em 03/11/2026: Supabase `20261103151428 agenda_normalized_a1` (arquivo `supabase/migrations/20261103151428_agenda_normalized_a1.sql`; md5 do texto registrado = md5 do arquivo commitado). Antes, ensaio `BEGIN…ROLLBACK` no banco real aprovado; o primeiro ensaio revelou e permitiu corrigir os defaults de `commit_agenda_change`.
- Tabelas: `agenda_settings`, `hospitals`, `patients`, `appointments` (ativas e canceladas juntas), `appointment_reschedules`, `patient_history_events` (imutável), `schedule_blocks`, `scheduling_rules`, `agenda_row_versions`. Soft delete (`archived_at`), fim do "apagar por omissão", paciente com dono permanente, RN (`newborn`/`guardian_name`) e CPF único por médico quando não RN.
- Dados de teste migrados sem perda: 3 pacientes, 9 consultas (2 canceladas), 35 eventos, 4 bloqueios, 1 regra, 2 hospitais; 2 sugestões pendentes negadas ("migração A1").
- `app_state` **congelado** (trigger rejeita escrita; `commit_agenda_change` desativada). Remoção prevista na A2.
- Concorrência por registro: merge de três vias com `agenda_row_versions` + `row_version`; 409 só quando o mesmo registro foi alterado por outra pessoa.
- Previews da Vercel usavam o **mesmo Supabase de produção** nessa época; desde 11/11/2026 usam banco próprio (ver seção 2).
- **Publicada em 03/11/2026:** [PR #83](https://github.com/LucasEspindula/agenda-rn/pull/83) mergeada com squash na `main`, commit `17f6a597e2a3e9eaf887a2dc40c6a720c5949b09` (árvore idêntica à do preview testado). CI da PR: 5 checks com sucesso, 1 pulado. Validação local: build, **606/606 testes**, lint (0 erros) e tsc. Vercel produção **READY**: `dpl_9cpWgZZpsbBwJxFZfwHjguCnEXnU` (alias `agenda-rn.vercel.app`); conferido em produção: `/api/billing` e `/billing` → 503 "Faturamento em reconstrução.", `/api/state` exige login.
- **Verificação no navegador (preview `a60efd6`, desktop e mobile):** cadastro de paciente RN (responsável obrigatório), criar/editar/cancelar consulta, bloqueio de dia inteiro (mobile mostra aviso e desabilita "+ Novo agendamento"; servidor responde 409), duas sessões simultâneas (registros diferentes salvam juntos; mesmo registro → 409 sem perda) e menus sem faturamento.
- **Corrigido durante a verificação:** edição de consulta bloqueada pelo bloco financeiro com faturamento pausado (agora ignorado via `window.AgendaBillingPaused`); seletor "Médico responsável" duplicado e obrigatório no cadastro de paciente (bug anterior à A1, impedia salvar); alinhamento do checkbox RN.
- **Contas de teste** (gerente, secretária com as duas agendas, médico) com domínio `@rnintegra.test`; médicos de teste Dra. Ana Teste (Cardiologia) e Dr. Bruno Teste (Ortopedia e Traumatologia); pacientes de teste incluindo o mesmo nome/CPF nos dois médicos e um RN. Senhas fora do repositório, em arquivo protegido por DPAPI na máquina do responsável.
- Observação operacional: nos previews, o login só funciona no endereço do próprio deployment (`VERCEL_URL`), não no alias do branch (regra de origem anterior à A1).

## 6B. Lançamento para outras clínicas — multiempresa, contas, LGPD e Configurações (06–09/11/2026)

**Decisão (06/11):** lançar para **outras clínicas**; a Fase 2B volta a valer. Auditoria de prontidão e testes de carga em `docs/prontidao-lancamento-2026-11-06.md`. Faturamento continua **pausado** (M2c, reconstrução futura).

**Estado verificado em 09/11/2026:** `main` = `7052ac9`; produção Vercel servindo essa versão (`/api/health`), região de funções `gru1`. Migrations aplicadas no Supabase após a A1 (versão registrada no banco → arquivo):

| Banco | Arquivo |
| --- | --- |
| `20261106181749 session_sync_single_call` | `20261106190000_session_sync_single_call.sql` |
| `20261106195225 agenda_period_window` | `20261106210000_agenda_period_window.sql` |
| `20261109113733 tenant_core_isolation` | `20261107120000_tenant_core_isolation.sql` |
| `20261109134208 accounts_multi_organization` | `20261109150000_accounts_multi_organization.sql` |
| `20261109142604 signup_email_invites` | `20261110120000_signup_email_invites.sql` |
| `20261109163509 lgpd_operations` | `20261110180000_lgpd_operations.sql` |
| `20261109175650 organization_area` | `20261111120000_organization_area.sql` |

As versões diferem porque o banco registra o momento da aplicação; ao comparar, use o **nome**. Toda migration foi ensaiada antes em `BEGIN…ROLLBACK` no banco real e aplicada só com autorização do responsável.

**O que entrou (PRs mergeadas com squash):**
- **#84–#86** — cartões da agenda conforme a duração, fluxo do anestesista, nome completo da equipe nos cartões.
- **#87** — capacidade fase 1: funções em `gru1` (perto do banco `sa-east-1`), `session_context` e `agenda_sync_signal` (uma chamada ao banco por requisição/sincronização), polling adaptativo 4–15 s.
- **#88** — agenda carregada por período (`load_agenda_window`; padrão 90 dias para trás + futuro); gravações seguem mesclando contra o estado completo.
- **#89 (M1)** — isolamento por organização: a organização vem do vínculo ativo, nunca do navegador; `guard_tenant_row` e `organization_id` nas tabelas restantes; buscas por id escopadas.
- **#90 (M2a)** — **contas** (cliente que contrata; dono, plano, status, limite de organizações) e **várias organizações por pessoa** (mesmo papel em todas, por enquanto); a organização ativa vai em cada RPC (`p_org`) e o banco confere o vínculo.
- **#91/#92 (M2b)** — cadastro público com conta em teste, confirmação de e-mail, redefinição de senha e **convites** (tokens de uso único, só SHA-256); respostas uniformes para não revelar contas existentes.
- **#93** — LGPD: exportação e anonimização de paciente, `security_events` (IPs/e-mails só em hash, 1 ano), manutenção diária via cron, `/api/health`.
- **#94** — lobby pós-login (`/organizacoes`) para quem tem várias organizações, primeiros passos na agenda da gerência, links de Termos/Privacidade; correção do login com 2+ vínculos.
- **#95** — **Configurações** na engrenagem do menu (`/organizacao`, só gerência) com abas **Médicos**, **Equipe** e **Organização**. Cadastros e a antiga Configurações foram absorvidos (`/doctors` e `/settings` redirecionam). Médicos sem dependência do faturamento; acesso de médico **só por convite**; agenda do médico (horário, regras e bloqueios) em `/organizacao/agenda`; agendas liberadas da secretaria editadas na Equipe. **Hospital virou texto livre** no agendamento (ex.: "HMV"): reaproveita nome/sigla existente sem diferenciar maiúsculas ou cria o registro ao salvar; secretaria só acrescenta; médico (sugestão) só usa nomes existentes. Sem migration.

**Regras novas a preservar:**
- O titular da conta não pode ser removido da organização; ninguém remove o próprio acesso.
- Senhas nunca são definidas pela gerência para outras pessoas em fluxos novos: convite por e-mail.
- Arquivos novos no Storage sempre em `org/<organization_id>/…` (documentos de cirurgia e comprovantes). Restam 9 objetos de teste no caminho antigo (8 comprovantes em `financial-documents`, 1 PDF órfão em `surgery-documents`); o banco bloqueia exclusão direta, então saem pelo painel/API de Storage na limpeza antes do lançamento.
- Previews usam banco próprio (`funqdoiubwskmhefbvjz`) desde 11/11/2026; login no preview só no endereço do próprio deployment. Migração nova: primeiro no preview, testar, depois em produção.
- O médico não recebe pendências da agenda (confirmar, guias, conflitos, sugestões): isso é da secretaria e da gerência.

**Pendências para o lançamento (lado do responsável):** `CRON_SECRET`; domínio e envio de e-mail (conta do Resend criada em 13/11/2026, com `RESEND_API_KEY` e `EMAIL_FROM` só no Preview e o remetente de teste; falta o domínio para ligar em produção com `APP_ORIGIN` e depois `PUBLIC_SIGNUP_ENABLED`); revisão jurídica de Termos/Privacidade e DPO; Supabase Pro (backups); **zerar banco e Storage** antes de abrir. **Técnico:** teste de restauração de backup; e-mail da agenda para médicos e anestesistas (agenda de amanhã às 20h do dia anterior e prévia da semana às 20h de sexta; depende do Resend); reconstrução do faturamento (M2c) com entidades recebedoras do médico; remoção de `app_state` (A2).

## 7. Log de continuidade

| Data | Alteração | Referência | Próximo passo |
| --- | --- | --- | --- |
| 29/10/2026 | Etapa 2A — acesso organizacional | PR #69 / `55be362...` | Isolamento da agenda |
| 29/10/2026 | Etapa 2B/1 — escopo RN Gestão da agenda, produção READY | PR #70 / `353de1ef...` | Inventário e plano 2B/2 |
| 29/10/2026 | Criação deste documento central | Commit que adiciona este arquivo | Atualizar a cada etapa com evidências |
| 29/10/2026 | Etapa 2B/2a — funções de cadastro e atendimento manual com membership e organization_id | PR #71 / `639c2b22...` / migration `20261029192723` / 521 testes | [Issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72): 2B/2b, financeiras e tabelas globais |
| 29/10/2026 | Etapa 2B/2b1 — nove tabelas financeiras com escopo físico, 20 FKs e guards | PR #73 / `86c7cf90...` / migration `20261029194356` / 528 testes / Vercel READY | [Issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72): ampliar isolamento das demais funções, tabelas, APIs e Storage |
| 29/10/2026 | Etapa 2B/2b2a — autorização de comprovantes e Storage por organização | PR #74 / `cc7cc5b1...` / migration `20261029200153` / 533 testes / Vercel READY | [Issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72): 9 funções SQL restantes e escopo completo das APIs/Storage |

| 29/10/2026 | Etapa 2B/2b2b-1 — quatro RPCs de pagamento, NF, atribuição e auditoria por organização | PR #75 / `41fdce6e...` / migration `20261029202018` / 540 testes / Vercel READY | [Issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72): 5 RPCs restantes e isolamento de APIs/Storage |

| 29/10/2026 | Etapa 2B/2b2b-2 — cinco RPCs de faturamento e fechamento escopadas | PR #76 / `770f0f25...` / migração `20261029203540` / 546 testes / Vercel READY | [Issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72): tabelas auxiliares, APIs/Storage e testes multiempresa |

| 29/10/2026 | Etapa 2B/3a — parcelas e envios ao portal com chaves de organização | PR #77 / `5d3426f6...` / migration `20261029205127` / 552 testes / Vercel READY | [Issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72): glosas, despesas, fechamento e isolamento de APIs |

| 30/10/2026 | Etapa 2B/3b — glosas, despesas e fechamentos com organização e 13 FKs | PR #78 / `2b4e497b...` / migration `20261030112459` / 559 testes / Vercel READY | [Issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72): cinco RPCs e APIs privilegiadas, logs, Storage e testes multiempresa |

| 30/10/2026 | Etapa 2B/3c1 — autorizações de glosas e envio ao portal escopadas no backend | PR #79 / `6ffbcc46...` / migration `20261030115731` / 566 testes / Vercel READY | [Issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72): fechamento mensal, regras do portal, logs e APIs privilegiadas |

| 30/10/2026 | Etapa 2B/3c2 — fechamentos mensais e regras de prazo por organização | PR #80 / `6cdf28ee...` / migração `20261030123323` / 574 testes / Vercel READY | [Issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72): consultas globais, logs, Storage e isolamento cross-tenant |

| 30/10/2026 | Etapa 2B/3d2 — 3 APIs financeiras privilegiadas isoladas por organização; CI aprovada; Vercel prod bloqueada por cota HTTP 402 | PR #82 / `35a3a32...` / CI `41073775407` | Resolver publicação da main na Vercel; validar deploy e ampliar relatórios/exportações/Storage e testes cross-tenant |

| 03/11/2026 | Agenda primeiro: deploy `bf524cff` confirmado; Fase 2B pausada; faturamento desligado; A1 agenda normalizada publicada | PR #83 / `17f6a597...` / migration `20261103151428` / 606 testes / Vercel READY `dpl_9cpWgZZp...` | Equipe de teste usa a agenda; A2 remove `app_state`; reconstrução do faturamento em branch e banco próprios |

| 06/11/2026 | Decisão de lançar para outras clínicas; cartões da agenda, capacidade fase 1 e agenda por período | PRs #84–#88 / `b4b285e` / migrations `session_sync_single_call`, `agenda_period_window` | Multiempresa (M1/M2) |

| 09/11/2026 | Isolamento por organização, contas e várias organizações, cadastro/convites, LGPD, lobby | PRs #89–#94 / `67d75a0` / 5 migrations (seção 6B) / Vercel READY | Consolidar administração |

| 09/11/2026 | Configurações na engrenagem (Médicos, Equipe, Organização); hospital em texto livre | PR #95 / `7052ac9` / sem migration / CI verde, preview testado, produção conferida | Pendências de lançamento (seção 6B) e faturamento M2c |

| 10/11/2026 | Monitoramento (base do assistente): captura de erros do servidor e do navegador sem dados pessoais, verificações a cada 15 min com conserto automático, catálogo de erros conhecidos, avisos por webhook/e-mail, `docs/runbook-incidentes.md` e `CLAUDE.md` | PR do branch `feat/monitoramento` / migração `monitoring` aplicada / 661 testes / preview testado | Configurar `MONITOR_URL` + `CRON_SECRET` no GitHub e um canal de aviso na Vercel |
| 11/11/2026 | Desempenho da agenda (cache por revisão, sincronização incremental, salvamento compactado) e banco separado para os previews | PRs #103–#104 / `b4a18f7` / migration `agenda_state_delta` (produção e preview) / preview testado nos 4 papéis | Toda migração nova vai para os dois bancos |
| 11/11/2026 | Revisão do que cada papel vê e faz; teste de carga por rede 4G externa (leituras ~0,3 s, salvamentos ~0,7 s, zero erros); assistente da agenda com resumo do dia e lembretes por papel (médico sem pendências) | PRs #106–#107 / `ef212c3` / sem migration / preview testado nos 4 papéis | E-mail da agenda para médicos (depende do Resend) |
| 11/11/2026 | PDF da agenda com layout único (impressão e e-mail); resumo de todas as agendas no `/hub` | PRs #108–#110 / `a4256b8` / sem migration | E-mail da agenda para médicos |
| 13/11/2026 | Contas da empresa (GitHub `rn-integra`, Supabase e Vercel "RN Integra"); limpeza do repositório, README novo e esqueleto do banco por `npm run db:schema`, com restauração testada na CI; `main` protegida por ruleset | PR #111 / `397856d` / sem migration | Funções do banco fechadas |
| 13/11/2026 | Funções do banco executáveis só pelo `service_role` (eram 20 abertas para `PUBLIC`/`anon`/`authenticated`, nenhuma perigosa), inclusive as futuras | PR #112 / `f86dd78` / migration `functions_service_role_only` (preview e produção) | Resend no Preview e e-mail da agenda |
| 13/11/2026 | Login: bloqueio progressivo por senha errada (10 em 15 min; 20 em 24 h bloqueiam por até 24 h; redefinir a senha libera), limites por conta e geral contando só falhas, regra única para senhas novas (12+ caracteres, sem senhas comuns nem o e-mail); documentação de segurança no README | PRs #113–#114 / `435be8a` / migration `login_failure_lockout` (preview e produção) / preview testado | E-mail da agenda para médicos |

## 8. Protocolo para o assistente em futuros chats

> Estamos continuando o **RN Integra**. Leia `docs/CONTEXTO_RN_INTEGRA.md` no GitHub `rn-integra/agenda-rn`, verifique `main`, PRs recentes, Supabase produção e Vercel. Preserve decisões e dados. Diga objetivamente a etapa atual, pendências e próximos riscos. Antes de implementar algo novo, examine o código real. Ao terminar, registre a nova referência e atualize este arquivo. Não presuma que testes antigos tenham sido reexecutados nem que o multiempresa esteja liberado.

**Manutenção:** tratar esta página como índice de continuidade, não como substituto dos documentos técnicos especializados presentes em `docs/`.
