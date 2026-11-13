# RN Integra — Homologação do faturamento fiscal por profissional

**Estado:** implementação publicada no repositório, **não ativada** enquanto migrations não forem testadas e aplicadas com autorização explícita.

## Escopo implementado

- Cobrança individual por médico participante do atendimento, com entidade recebedora histórica, convênio do paciente, modalidade, canal e pagador/repassador.
- Nova NF de convênio baseada em `billing_record_id`, com seleção individual das cobranças, valores informados pelo usuário e conferência do total líquido.
- NFs profissionais pagas ou históricas ficam em modo consulta para evitar edição financeira incompatível com o histórico; o fluxo formal de correção/substituição fiscal permanece separado.
- Pagamento PARTICULAR passa pela confirmação do tomador e composição de pagamento. O registro de `invoice_requests` ocorre na mesma transação financeira que o pagamento.
- Duas cobranças da mesma cirurgia podem gerar solicitações fiscais particulares distintas (único ativo por `billing_record_id`).
- Reversão de pagamento particular cancela a solicitação **pendente**; com NF já emitida, ajustes financeiros são bloqueados até correção documental.
- Restrição clínica da agenda é preservada sem exigir que cirurgião e anestesista usem a mesma forma de cobrança.
- A leitura financeira de secretárias continua isolada por cobrança/profissional, e o endpoint da nova funcionalidade está bloqueado por padrão.

## Migrations necessárias, em sequência

1. `supabase/migrations/20261016120000_independent_professional_billing.sql`
2. `supabase/migrations/20261016183000_professional_private_fiscal_requests.sql`



Antes da aplicação, verificar `supabase_migrations.schema_migrations`, versões já presentes, snapshot do esquema e backup consistente. **Não aplicar em produção antes de executar todos os testes em uma cópia isolada do banco.**

## Testes direcionados

```bash
node --test tests/independent-professional-billing.test.mjs tests/professional-fiscal-flow.test.mjs
npx tsc --noEmit
npm run build
```

A Vercel compila os commits, mas isso não substitui a execução das migrations com as constraints e triggers reais do Supabase.

## Cenários obrigatórios de homologação

1. Migração sobre uma cópia anonimizada dos dados atuais, verificando preservação de IDs, pagamentos, NFs, itens e logs.
2. Mesmo atendimento: cirurgião convênio e anestesista particular. A quitação de um não altera o outro.
3. Dois profissionais particulares no mesmo atendimento, ambos pagos: duas solicitações distintas; nenhuma duplicada para a mesma cobrança.
4. Confirmação fiscal com CPF inválido ou tomador inconsistente falha integralmente, sem pagamento parcial.
5. Reversão de pagamento com solicitação PENDENTE cancela apenas a solicitação da cobrança correspondente.
6. Reversão de pagamento com solicitação ISSUED é bloqueada até regularização fiscal.
7. Uma NF conveniada com diversas cobranças, inclusive profissionais do mesmo procedimento: somatório exato dos valores individuais.
8. Pagador efetivo/cooperativa diferente do convênio do paciente sem misturar empresas recebedoras.
9. Um médico não visualiza os honorários do outro; a secretária só acessa cobranças de profissionais autorizados.
10. NFs e solicitações particulares antigas continuam acessíveis sem reemissão nem mutação do histórico.
11. Testar concorrência: duas sessões tentando atualizar a mesma NF/cobrança recebem bloqueio por versão.
12. Conferir logs de operação, status e `payment_parts`, além da integridade dos recibos.

## Ativação

O código está protegido por variável de ambiente de servidor:

```env
RN_PROFESSIONAL_BILLING_ENABLED=true
```

**Nunca ativar antes de aplicar e verificar as duas migrations no mesmo ambiente.** O valor ausente ou diferente de `true` deixa a funcionalidade nova inacessível (inclusive pela API). Após homologação, liberar primeiro a um grupo restrito de usuários administrativos.

## Limitações conhecidas

- A composição financeira de **convênio com repasse direto** exige regra própria; quitação direta como PAGO fica bloqueada. Faturamento por NF/lote é suportado.
- O formulário novo não envia comprovantes anexos automaticamente. O gerenciamento documental existente deve ser preservado.
- Cancelamento/substituição de NF profissional já paga exige evolução e homologação adicional: nesta entrega há bloqueio de edição.
- O novo fluxo de pagamento particular gera solicitação quando não há número de NF já emitida; conferir o caso excepcional de documentos anteriores.
- O Fechamento Mensal consolidado por PJ/PF, alertas de prazo e gestão de glosas pertencem às próximas etapas.

## Critério de liberação

**Go/No-Go:** somente após teste PGlite direcionado, testes de integração com esquema real, validação das permissões, simulação de restauração e aprovação explícita da migration de produção. Nenhuma simples compilação da Vercel autoriza alteração do banco.
