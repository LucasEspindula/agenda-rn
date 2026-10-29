# Isolamento por organização — RN Integra

## Modelo aprovado

A organização (*tenant*) é quem opera o RN Integra, não o local do atendimento:

- **Empresa de gestão médica:** RN Gestão, atendendo vários médicos por agendamento, faturamento, NF ou combinação.
- **Clínica/consultório:** sua própria operação administrativa.
- **Médico independente:** sua própria operação administrativa.

Hospital ou clínica **onde ocorre um procedimento** continua sendo uma informação da agenda; não é automaticamente um tenant. A **entidade recebedora** (CPF/CNPJ que recebe os pagamentos ou emite NF) também não é o tenant. Um profissional pode ter contratos/serviços diferentes dentro da mesma organização.

## Estado antes da fundação (28/10/2026)

- 46 tabelas de aplicação no esquema `public`.
- Nenhuma coluna de tenant (`organization_id`, `tenant_id` ou `workspace_id`) antes da fase 1.
- Um `app_state` global (ID 1), com pacientes, agendamentos e regras em JSONB.
- 13 funções SQL consultam `app_state` e contêm referências ao ID 1.
- Contas em `users` possuem um papel global; sessões em `sessions` não selecionam organização.
- O servidor acessa o Supabase com credencial privilegiada. Portanto, isolamento apenas por RLS **não** resolve: APIs e funções SQL devem validar a organização.

## Fase 1 — fundação (aplicada em 28/10/2026)

A migration `20261028203004_organization_foundation.sql` cria `organizations` e `organization_memberships` privadas (RLS habilitada, sem políticas para clientes e privilégios `anon`/`authenticated` revogados), associa os usuários existentes à organização inicial **RN Gestão**, sem atualizar ou mover dados clínicos/financeiros.

**Aplicação confirmada:** o Supabase registrou a migration como `20261028203004:organization_foundation`. A consulta pós-migração confirmou 1 organização, 4 memberships ativos para 4 usuários, RLS habilitada em ambas as tabelas e ausência de permissões de leitura `anon`/`authenticated`. A agenda legada permanece com 1 registro.

**Porta fechada:** esta fase NÃO habilita o cadastro de uma segunda organização, NÃO altera o acesso atual e NÃO significa que há isolamento operacional. Usuários criados depois do backfill precisam ser associados por um fluxo transacional e auditável quando a etapa seguinte for ativada.

## Fases necessárias antes de abrir o SaaS a terceiros

1. **Autenticação e sessões:** escolher organização ativa a partir de membership persistido no servidor; papel por organização; revogação e mudanças de organização fail-closed. Nenhuma seleção de tenant ou papel confiada ao corpo da requisição.
2. **Fonte da agenda:** substituir o `app_state(id=1)` global por registros vinculados à organização, com chaves/versões independentes; revisar as 13 funções e os endpoints de agendamento para eliminar referências globais.
3. **Todos os dados financeiros e fiscais:** adicionar `organization_id` a médicos, permissões de agendas, atendimentos, cobranças, NFs, solicitações, comprovantes, glosas, despesas, fechamentos, logs e demais entidades; backfill e FKs/índices de isolamento. `entidade_recebedora` permanece distinta.
4. **RPC e Storage:** validar membership e tenant em *todas* as funções e APIs privilegiadas; usar caminhos de arquivo por organização e checagem de vínculo antes de assinar URLs.
5. **Operação e testes:** matriz de acessos com pelo menos duas organizações e usuários compartilhados entre elas; validar leituras, gravações, exportações, buscas por ID, PDFs, logs, anexos e manipulação de sessão; plano de rollback e restaurabilidade.

### Critérios de liberação

- Nenhuma API/RPC/Storage entrega ou altera dados de outra organização mesmo com IDs forjados.
- Gerente Geral, Secretária e Médico exercem apenas permissões de sua organização.
- A organização RN Gestão conserva comportamento e dados após migração.
- Testes de integração com duas organizações e deploy canário aprovados.
- Backup restaurável validado. O backup anterior do esquema `public` **não** é um backup dos dados.

Até que todos esses critérios sejam atendidos, **não habilitar onboarding multiempresa**.

## Fase 2A — ciclo de vida dos acessos RN Gestão (29/10/2026)

- Cadastro de contas via `save_user_access` passa a incluir o vínculo `organization_memberships` na **mesma transação**; o cadastro de médicos usa essa mesma função.
- Papel e ativação ficam sincronizados entre `users` e `organization_memberships`; a API de gestão lista apenas membros RN Gestão, inclusive inativos.
- Remoção física de usuários substituída por desativação auditável. Sessões existentes são revogadas, e login e validação de sessão conferem `users.active`, o vínculo ativo e o papel da organização.
- Reativação exige ação explícita do gerente; históricos financeiros, agendamentos, auditoria e permissões são preservados.
- Ainda **não** há segunda organização operando: cadastro e sessões falham se a tabela de organizações deixar de conter apenas RN Gestão. A próxima etapa deve isolar agenda/dados financeiros de ponta a ponta e substituir os papéis globais antes do onboarding de terceiros.

## Fase 2B/1 — estado da agenda vinculado à organização (29/10/2026)

- O documento `app_state` passa a ter `organization_id` obrigatório, FK para `organizations` e índice único. A única linha anterior (`id=1`) é preservada sem alteração de `payload`, `version` ou `updated_at` e vinculada à RN Gestão.
- As leituras da agenda, regras, pacientes e a visão auxiliar do faturamento filtram a organização por vínculo no banco; o cliente nunca fornece o tenant.
- `commit_agenda_change` valida usuário/membership ativo e altera somente a linha RN Gestão, preservando lock, revisão, triggers, auditoria e transação já existentes.
- Um bloqueio físico temporário impede inserir, excluir ou transferir a linha legada para outra organização. É intencional: **ainda não existe operação multiempresa**.
- As rotinas financeiras e de cadastro médico que ainda consultam ou atualizam `app_state(id=1)` seguem usando a mesma linha vinculada à RN Gestão. Não há migração destrutiva nem duplicação do documento.
- **Próxima etapa obrigatória:** parametrizar as consultas/gravações remanescentes das funções SQL por organização e remover o `id=1` fixo; só então evoluir as demais tabelas e arquivos para escopo independente por tenant.

Este marco protege e documenta o estado existente, mas **não declara isolamento multi-tenant completo nem libera onboarding de terceiros**.

## Fase 2B/2a — primeira migração das rotinas legadas (integrada)

- Proposta versionada em `20261029192723_legacy_agenda_directory_org_scope.sql`: atualizar `save_doctor_directory` e `save_manual_attendance`.
- Nova função `require_rn_agenda_actor_organization(p_actor)`: verifica organização RN Gestão ativa, exclusivamente uma organização operando, conta e membership ativos com papéis coerentes e estado da agenda correspondente. Função restrita ao `service_role`.
- As duas rotinas passam a pesquisar/atualizar `app_state` por `organization_id` do vínculo validado, removendo o `id=1` desses caminhos. A consulta de convênio do atendimento manual também fica limitada ao documento da organização.
- Testes PGlite e inspeção estática adicionados em `tests/agenda-legacy-organization-scope.test.mjs`, cobrindo acesso ativo/inativo, divergência de papel, gerente vs secretária e bloqueio se surgir uma segunda organização.
- **Ainda não é isolamento multiempresa completo.** Permanecem funções financeiras legadas, tabelas globais, APIs privilegiadas e anexos a migrar.
- **Concluído em 29/10/2026:** PR #71 mergeada em `639c2b22d6c6098ff50996b73167f4489c691284`; migração `20261029192723 legacy_agenda_directory_org_scope` aplicada no Supabase e verificada por catálogo (funções com organização, sem execução para `anon`/`authenticated`); CI com **521 testes aprovados**. Ainda resta confirmar o deploy final. Dados em uso são de teste, mas segregação real segue obrigatória.

### Próximo marco — 2B/2b

Inventário, ordem técnica e critérios de aceite: [issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72). Dez funções financeiras ainda dependem de referências globais ao documento legado; tabelas essenciais como `attendances`, `billing_records`, `invoices`, `billing_entities`, `doctors`, `financial_attachments` e `invoice_requests` não possuem `organization_id` no catálogo atual. A 2B/2b deve migrar esquema, FKs, RPCs e rotas de modo verificável. **Não liberar novos tenants.**

## Fase 2B/2b1 — chaves físicas no núcleo financeiro (publicada em 29/10/2026)

Esta primeira subetapa da [issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72) adiciona `organization_id` em nove tabelas centrais: `doctors`, `billing_entities`, `billing_doctor_entities`, `attendances`, `billing_records`, `invoices`, `invoice_billing_records`, `invoice_requests` e `financial_attachments`. A **organização cliente** é diferente da **entidade recebedora**.

O SQL cria vínculos à organização e chaves `(id, organization_id)` que permitem **20 FKs compostas**. Isso impede vincular filhos de uma organização a registros pais de outra; as FKs de itens de NF preservam a cascata. Os campos são obrigatórios, preenchidos nos registros antigos pelo *default* validado no banco, sem atualizar dados clínicos e sem disparar os triggers de negócio por uma operação de UPDATE em massa.

**Compatibilidade temporária:** enquanto o backend ainda opera apenas a RN Gestão, o default e os triggers recusam qualquer escrita se houver uma segunda organização cadastrada. O cliente não escolhe tenant. O cadastro de novos tenants **permanece bloqueado**. O serviço com credencial privilegiada ainda precisará ser escopado em todas as rotas; RLS isoladamente não resolve o problema.

A migration e os testes em PGlite foram adicionados na branch `feat/rn-financial-organization-foundation-2b2b1-20261029`. **Migração aplicada no Supabase:** `20261029194356 financial_tenant_keys_foundation`. Banco verificado: 9 colunas NOT NULL com defaults, 20 FKs compostas, 9 triggers, 9 índices compostos e RLS ativo nas 9 tabelas. A PR [#73](https://github.com/LucasEspindula/agenda-rn/pull/73) foi mergeada em `86c7cf901fcc1df10a66f6f81c131e55944b26bc`: **528/528 testes aprovados no commit final**, lint e tipos aprovados; deploy de produção Vercel `dpl_7vsZbHHjTdjaHa36MGwNnnUatQV2` **READY**. As 20 FKs foram confirmadas validadas e as tabelas mantêm RLS sem exposição direta a `anon` ou `authenticated`.

**Pendências após a 2B/2b1:** estender `organization_id` às demais tabelas operacionais, validar relacionamentos adicionais, migrar as dez funções SQL legadas, escopar APIs financeiras/reports/Storage e comprovar segregação com duas organizações em testes isolados. Como os registros existentes são de teste, os registros incompatíveis podem ser limpos pontualmente, mas documentar a exclusão e não reduzir a segurança para contornar o problema.

## Fase 2B/2b2a — autorização de comprovantes por organização

A primeira subetapa de [#72](https://github.com/LucasEspindula/agenda-rn/issues/72) endurece `authorized_financial_attachment_actor`: papel e membership devem estar ativos e coerentes, o destino precisa existir na organização, a secretária só pode vincular comprovante a NF quando tem permissão para **todos** os seus atendimentos, e o anestesista é consultado no documento da organização em `app_state`.

Novos comprovantes passam a receber prefixo de Storage com `org/<organization_id>/payment-proofs/`. Comprovantes antigos permanecem válidos e legíveis: não apagar objetos nem quebrar o histórico. As consultas privilegiadas de metadados no endpoint recebem filtro de organização ativa. O frontend não determina o tenant.

**Escopo parcial:** continuamos com a RN Gestão como única organização e ainda restam rotas financeiras, funções SQL e tabelas auxiliares a migrar. O guard singleton é intencional e não deve ser removido. Migração **aplicada e conferida** no Supabase como `20261029200153 financial_attachment_organization_authorization`: as funções continuam `SECURITY INVOKER`, com execução pública revogada e sem referência direta a `app_state.id=1`. CI do commit reconciliado com **533/533 testes aprovados**, lint, tipos e build aprovados. PR [#74](https://github.com/LucasEspindula/agenda-rn/pull/74) mergeada no commit `cc7cc5b18eb63886edd02d0ee01d4248dfd3bb2b`. Deploy de produção da Vercel `dpl_HegVbow8mWUckkXDntW4wzogPwBq` confirmado **READY**. Esta etapa NÃO é isolamento multiempresa completo.


## Etapa 2B/2b2b-1 — escopo das RPCs financeiras legadas (publicada em 29/10/2026)

Migração aplicada `20261029202018_financial_legacy_rpcs_org_scope.sql`: quatro funções hoje dependentes de `app_state.id=1` passam a consultar a organização validada no PostgreSQL: `finish_private_payment`, `update_pending_invoice_request`, `attribute_financial_attendance` e `financial_log_snapshot`. Cobrança, atendimento, entidade recebedora, solicitações de NF e nomes de auditoria recebem validação de escopo, inclusive durante escritas. Nas funções com `p_actor`, a organização vem da conta e vínculo ativos; nas funções internas sem ator, aplica-se o guard RN Gestão-only no servidor. As funções permanecem `SECURITY INVOKER` e apenas `service_role` pode executá-las diretamente.

Testes PGlite: conta desativada, cobrança inexistente, edição de solicitação, atribuição por anestesista, nomes de auditoria e falha segura com segunda organização.

**Atenção:** esta etapa não elimina todas as funções financeiras legadas. Restam rotinas volumosas de faturamento e fechamento mensal, além de tabelas auxiliares e rotas privilegiadas. Não habilitar cadastro de outras organizações. Migração `20261029202018` **aplicada** no Supabase; catálogo verificou as quatro funções, `SECURITY INVOKER`, sem execução para `anon`/`authenticated` nem predicados globais `app_state.id=1`. CI final **540/540 testes aprovados**, build/lint/tipos aprovados. PR [#75](https://github.com/LucasEspindula/agenda-rn/pull/75) mergeada no commit `41fdce6ec22e67881e03c78c8a5dc0149a3e29f1`. Deployment de produção Vercel `dpl_H6RHehFWAnuod72Df9njc3XbRj8Z` **READY**. Próximo marco: as cinco RPCs financeiras/fiscais remanescentes e isolamento das demais tabelas e APIs.

## 2B/2b2b-2 — Faturamento e relatório mensal

Migration publicada `20261029203540_financial_five_legacy_rpc_org_scope.sql`. Cinco RPCs legadas recebem organização derivada do ator ativo e escopo no documento clínico, removendo `app_state.id=1`. O relatório mensal exige entidade recebedora dentro da organização. Consultas importantes de profissionais, atendimentos e vínculos são limitadas por `organization_id`. Novos clientes continuam bloqueados. Testes de API, RLS, tabelas auxiliares e segregação entre duas empresas ainda são necessários. Migração aplicada e conferida em PostgreSQL, 546/546 testes aprovados no CI final; PR #76 integrada, Vercel produção READY. Permanecem outras superfícies e rotas a isolar.

## Etapa 2B/3a — isolamento do grafo de pagamentos e submissões

Na primeira fatia da 2B/3, as tabelas `payment_parts`, `billing_portal_submissions` e `billing_portal_submission_events` passam a ter `organization_id` obrigatório, default RN Gestão temporário e trigger de bloqueio para outra organização. Quatro FKs compostas preservam a organização entre forma de pagamento, cobrança, NF, envio e evento de envio. O legado continua operacional sem atualizar linhas e acionar triggers históricos.

Migração publicada: `20261029205127_finance_auxiliary_tenant_keys.sql`; testes: `tests/financial-auxiliary-org-keys.test.mjs`. Migração aplicada e verificada no Supabase sob a versão `20261029205127`: 3 colunas NOT NULL, 4 FKs compostas, 3 triggers, RLS ativo e 10 parcelas preservadas. CI final **552/552 testes, zero falhas**. PR [#77](https://github.com/LucasEspindula/agenda-rn/pull/77) mergeada no commit `5d3426f6dbe7f23a64cdd502e090dfd2a6490a07`; Vercel produção **READY** (`dpl_FP4trqrWf5vNZc5mZjXbcQg7Se7L`).

**Não habilitar multiempresa:** faltam escopo nas rotas que usam service_role, revisão de relatórios, Storage, demais tabelas auxiliares e testes com dois tenants. Consulte [issue #72](https://github.com/LucasEspindula/agenda-rn/issues/72).
