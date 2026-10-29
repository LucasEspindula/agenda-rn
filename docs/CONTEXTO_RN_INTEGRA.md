# RN Integra — Contexto central e continuidade

> Atualizado em 29/10/2026 (America/Sao_Paulo). Documento de transferência entre conversas de desenvolvimento. **Não substitui verificações ao vivo no GitHub, Supabase e Vercel.**

## 1. Como retomar o trabalho em um novo chat

1. Ler este arquivo inteiro.
2. Inspecionar o `main` e as PRs recentes do repositório `LucasEspindula/agenda-rn`; não pressupor que o SHA deste snapshot ainda seja o atual.
3. Consultar migrações e estado do Supabase de produção `nagddicinjszfrtwgjbu`, e confirmar o deploy em produção do projeto Vercel `agenda-rn`.
4. Comparar **código + banco + deploy**, diferenciando *proposto*, *mergeado*, *migração aplicada* e *publicado*.
5. Antes de continuar uma fase, ler suas notas de arquitetura e auditar a implementação anterior. Alterações financeiras, RLS, autorização e migrações exigem testes e revisão cuidadosa.
6. Ao concluir uma etapa, atualizar neste arquivo: data, PR, SHA, migração, testes, deploy, pendências e próxima ação. Nunca registrar um teste ou publicação sem evidência.
7. Evitar segredos, dados de pacientes, chaves e credenciais nesta documentação. Não alterar banco de produção apenas para sincronizar contexto.

## 2. Identificação e infraestrutura

- Produto: **RN Integra** (nome vigente em toda a interface; antigo Agenda RN).
- Repositório privado: `LucasEspindula/agenda-rn`; branch principal: `main`.
- Supabase produção: `nagddicinjszfrtwgjbu`; referência histórica de Preview: `vmpvngjppnouqfzahezr` (rever antes de usar).
- Vercel: projeto `agenda-rn`; equipe `team_FBTsVaBXUxWhfN3bwm5g9142`.
- Objetivo: evoluir o sistema existente para SaaS multiempresa comercializável, **sem expor dados entre organizações**.
- Estratégia: preservar estabilidade e compatibilidade do cliente existente (RN Gestão), migrar gradualmente, sem criar novos tenants até concluir o isolamento.

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

## 8. Protocolo para o assistente em futuros chats

> Estamos continuando o **RN Integra**. Leia `docs/CONTEXTO_RN_INTEGRA.md` no GitHub `LucasEspindula/agenda-rn`, verifique `main`, PRs recentes, Supabase produção e Vercel. Preserve decisões e dados. Diga objetivamente a etapa atual, pendências e próximos riscos. Antes de implementar algo novo, examine o código real. Ao terminar, registre a nova referência e atualize este arquivo. Não presuma que testes antigos tenham sido reexecutados nem que o multiempresa esteja liberado.

**Manutenção:** tratar esta página como índice de continuidade, não como substituto dos documentos técnicos especializados presentes em `docs/`.
