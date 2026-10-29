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
