# RN Integra — Auditoria técnica e de segurança
**Data:** 22 de outubro de 2026
**Referência:** `audit/rn-integra-full-review-20261022`
**Status:** auditoria ampla, **não homologado para declaração de segurança total**.

## Escopo examinado
Repositório Next.js/React/TypeScript, APIs, autenticação própria, agenda legada em JavaScript, Faturamento, NFs, anexos, fechamentos, integrações experimentais e permissões no Supabase. No repositório foram inventariados **413 arquivos versionados**, cerca de **35 endpoints HTTP** (contabilizando os diretórios de API), **52 migrations** e **46 tabelas do esquema `public`**.

Auditou-se também os cenários operacionais de **Gerente Geral**, **Secretaria**, **Faturamento**, **Médico** e **Anestesista**. O sistema autentica apenas `general_manager`, `secretary` e `doctor`: Faturamento é módulo/permissão; Anestesista é especialidade/profissional com perfil de médico, não papel autônomo. Os cenários foram **simulados em testes de políticas e APIs**, não executados com senhas de cinco contas reais.

## Evidência da bateria de CI
GitHub Actions [auditoria](https://github.com/LucasEspindula/agenda-rn/actions/runs/39773977029):
- `npm ci --ignore-scripts`: aprovado.
- `npx tsc --noEmit`: aprovado, **com a ressalva** de que `app/billing/billing-client.tsx` tem `// @ts-nocheck`.
- `npm run build`: aprovado.
- `npm test`: **374 testes, 338 aprovações, 36 falhas** no snapshot examinado. Entre as falhas constam contratos antigos de interface/relatórios, testes com fixtures desatualizadas e teste que tenta ler `.next/static` **antes do build**. Devem ser discriminadas, não removidas indiscriminadamente.
- `npm run lint`: **52 apontamentos** (14 erros, 38 avisos), incluindo hooks React e símbolos sem uso.
- `npm audit --omit=dev --audit-level=high`: **2 alertas críticos e 2 altos**, resultado não aprovado.

### Segurança de dependências — **BLOQUEADOR**
- `next@16.3.5` — *critical*; atualizar e homologar versão corrigida (npm recomendou `16.4.2`).
- `fast-xml-parser@5.2.5` — *critical*; corrigir limites de parser/XML e testar o módulo Perseu e importações (npm recomendou `5.11.2`).
- `sharp@0.35.4` — *high*; corrigir versão (npm recomendou `0.35.5`).
- `source-map-js` — *high*; atualizar versão transitiva conforme lockfile.
Os alertas não comprovam exploração prática no projeto, mas **não devem ser ignorados**. O upgrade do `package-lock.json` não foi implantado nesta auditoria.
**Issue:** [#20 — dependências de segurança](https://github.com/LucasEspindula/agenda-rn/issues/20).

## Segurança do Supabase
- Verificadas **46 tabelas** de `public`: RLS habilitado em todas; sem permissões diretas de leitura/gravação para `anon` e `authenticated` nos critérios examinados.
- Identificadas três funções com EXECUTE público herdado: `restore_billing_invoice`, `guard_billing_monthly_closing_immutable`, `log_monthly_financial_action`.
- **Corrigido no banco de produção** por migration `20261022090000_restrict_legacy_function_exposure.sql`: revogadas EXECUTE de `public`, `anon` e `authenticated`, preservando serviço autorizado. Pós-verificação por SQL: as três funções retornaram `false` para execução anônima/autenticada e `true` para `service_role`.
- Constatadas **zero duplicações** de solicitações fiscais `PENDING`/`ISSUED` por faturamento no diagnóstico agregado; 3 solicitações pendentes e 2 emitidas, sem pendente com NF associada nem emitida sem NF.
- Não se usaram senhas de usuários nem se criaram cobranças ou pagamentos artificiais.
- A verificação de RLS não substitui um teste de invasão nem abrange automaticamente todos os buckets Storage e configurações de infraestrutura.

## Correções propostas na branch de auditoria
**Estas alterações de aplicação permanecem na branch até homologação; não confundir com produção:**
1. **Paciente de cirurgia com anestesista:** `visibleState` agora inclui, para o profissional autorizado no atendimento, os dados clínicos básicos do paciente mesmo se cadastrado na agenda do cirurgião. O perfil médico continua sem acesso a CPF/endereço; secretaria vinculada apenas à anestesia não ganha permissão de editar cadastro de outro médico.
2. **Confirmação de gravação:** os fluxos de status, cancelamento, reagendamento, cadastro de paciente, regras e bloqueios aguardam `persist()` antes de fechar o modal e mostrar sucesso. Se o servidor recusar a atualização, o fluxo não apresenta confirmação falsa.
3. **Legado não utilizado:** retirados os helpers sem chamadas `evaluateBlocks` e `requestAppointmentStatus` de `public/legacy-app.js`.
4. **Proteção de execução RPC:** migration versionada para as revogações aplicadas.
5. **Testes adicionais:** `tests/audit-five-context-role-matrix.test.mjs` e `tests/audit-agenda-persistence-security.test.mjs`.

## Matriz de cenários simulados
| Contexto | Casos exercitados | Limite |
|---|---|---|
| Gerente geral | Visibilidade de agendas e edição autorizada de status; APIs administrativas exigem papel | Sem sessão real no navegador |
| Secretaria | Restrição por agendas, bloqueio de alteração de dados de terceiros, dados fiscais por atendimento autorizado | Sem login E2E |
| Faturamento | Acesso central pela Gerência e proibição de escrita de Médico; pedidos pendentes e NFs com regras preservadas | Não há perfil independente chamado `faturamento` |
| Médico | Agenda permitida e sem edição direta de agendamentos; financeiro isolado pela projeção específica | Não substitui teste de médico autenticado |
| Anestesista | Agenda compartilhada, paciente ligado à cirurgia e ocultação de CPF/endereço; secretaria de anestesia só lê cadastro alheio | Sem agendamentos atuais com anestesista vinculado no snapshot SQL; testes com fixture |

## Dívidas técnicas e inconsistências restantes
- **Suíte geral e lint vermelhos:** issue [#21 — qualidade](https://github.com/LucasEspindula/agenda-rn/issues/21). Não confundir build verde com aprovação funcional.
- `app/billing/billing-client.tsx` ~93 KB usa `// @ts-nocheck`. Modularizar, tipar e retirar a supressão; alto risco de erro de interface sem detecção.
- `public/legacy-app.js` ~148 KB e `public/legacy.css` ~71 KB coexistem com React/Next e outras folhas de estilo; fluxo de sobreposição visual e scripts antigos requer refatoração incremental e testes visuais.
- `app/billing/billing.css` ~75 KB; CSS monolítico. Extração somente com verificações de interface.
- **Fechamento mensal, divisão por profissionais, glosas, despesas e NF compartilhada:** existem testes automatizados, mas a execução integral não passou. Requerem conciliação manual com amostras controladas e testes de impressão em navegador autenticado.
- Dependências e funcionalidades experimentais precisam de atualização de vulnerabilidades; evitar liberar o Perseu/controle de convênios sem revisar limites de arquivos e parser XML.
- Não foi possível certificar cinco logins reais, navegadores de secretária/médico/anestesista com credenciais de homologação, impressão física, responsividade em dispositivos físicos ou pentest externo.

## Critérios para homologação final
1. Corrigir as quatro vulnerabilidades apontadas, atualizar manifestos/lockfile e repetir `npm audit`.
2. Classificar e resolver as 36 falhas; executar o conjunto que depende de `.next/static` após build.
3. Tratar os 14 erros de lint e revisar avisos.
4. Testar em ambiente isolado os cinco contextos com contas de homologação: criação/edição/cancelamento, solicitações e emissão/substituição de NF, pagamentos, comprovantes, fechamento mensal e relatórios.
5. Validar concorrência de duas sessões alterando o mesmo agendamento, PDF/print, acesso cruzado, logs e recuperação após erro de rede.
6. Validar a versão de preview antes de integrar as alterações amplas à produção.

**Conclusão:** houve avanços concretos de segurança e confiabilidade, mas a auditoria identificou bloqueadores de release. Não se deve atestar RN Integra como inteiramente seguro ou finalizado sem concluir os itens pendentes.
