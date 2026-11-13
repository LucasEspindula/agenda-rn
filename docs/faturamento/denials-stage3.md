# RN Integra — Etapa 3: Gestão de glosas e recursos

**Situação:** código enviado à `main`; desabilitado por padrão até homologação das migrations. Não aplicamos alterações ao banco nem criamos branches.

## Fluxo operacional

1. Registrar glosa **total ou parcial** para uma cobrança de convênio de um profissional que participou de atendimento realizado. Informar data, valor, motivo e referência do pagador (opcional).
2. Protocolar recurso com data, protocolo, valor recorrido e observações. Somente um recurso da mesma glosa pode ficar aguardando decisão de cada vez.
3. Registrar decisão: **deferido**, **parcialmente deferido** ou **indeferido**, com data e valor deferido (zero para indeferimento).
4. Registrar recuperação individual vinculada a recurso deferido, indicando data, valor e referência de recebimento. O SQL impede recuperar mais que o valor deferido de um recurso ou que o total originalmente glosado.
5. Encerrar glosa com motivo, somente quando não houver recurso aguardando decisão. Casos encerrados ficam somente leitura e preservam toda a trilha de eventos. Valor não recuperado em glosa encerrada fica destacado como perda.

Uma glosa pode ter mais de um recurso, mas nenhuma recuperação pode superar o valor original. Os recursos, decisões e recuperações são registros separados, ligados à mesma `billing_record_id` e `billing_entity_id`. Cada operação grava autor e data em `billing_denial_events`.

**Crucial:** recuperação da glosa é um indicador operacional de recuperação confirmada, não crédito automático em caixa. Não altera `billing_records.payment_status`, `received_amount`, NF, `paid_at`, nem consolidação mensal. A conferência de depósito/contabilidade continua no faturamento da PJ/PF.

## Arquivos

- `supabase/migrations/20261016220000_billing_denials_and_appeals.sql`: quatro tabelas (`billing_denial_cases`, `billing_denial_appeals`, `billing_denial_recoveries`, `billing_denial_events`) e RPC `save_billing_denial`.
- `app/api/billing/denials/route.ts`: leitura e atualização filtradas por profissional autorizado; dupla checagem da secretaria (API e RPC).
- `app/billing/glosas/page.tsx`: entrada isolada; acesso apenas gerência e secretaria.
- `app/billing/denial-manager.tsx`: filtros por PJ/PF, profissional, situação e busca, totais e histórico.
- `app/billing/denial-action-dialog.tsx`: formulários das cinco operações.
- `lib/denial-totals.js`: cálculo em centavos, distinguindo saldo em acompanhamento de perdas encerradas.
- `tests/denial-totals.test.mjs` e `tests/denial-stage3-contract.test.mjs`: testes direcionados.

O menu **Faturamento → Glosas** e o acesso da secretaria só são exibidos quando o módulo é habilitado.

## Sequência para futura homologação

Aplicar somente em banco isolado e já validado, na ordem:

1. `20261016120000_independent_professional_billing.sql`
2. `20261016183000_professional_private_fiscal_requests.sql`
3. `20261016203000_billing_portal_submissions.sql` (Etapa 2)
4. `20261016220000_billing_denials_and_appeals.sql` (Etapa 3)

Depois de validar os testes reais e as permissões, ativar apenas no ambiente aprovado:

```env
RN_DENIALS_ENABLED=true
```

O valor ausente ou diferente de `true` mantém a página e a API indisponíveis. **Não ativar agora.**

## Cenários obrigatórios de validação

- Glosa total e parcial do mesmo atendimento, associadas a profissionais/recebedoras distintas.
- Secretaria autorizada ao anestesista não pode ver ou editar glosa do cirurgião.
- Glosa particular deve ser recusada.
- Recurso protocolado: pendente, deferido, parcialmente deferido e indeferido.
- Valor recuperado jamais pode exceder o deferido no recurso nem o glosado na ocorrência.
- Duas atualizações simultâneas à mesma glosa falham por versão (`updated_at`) e bloqueio transacional.
- Encerramento com recurso pendente é recusado; histórico permanece consultável.
- Glosa encerrada sem recuperação permanece no total de **perdas não recuperadas**.
- Marcar glosa como recuperada não altera a NF, pagamento, caixa ou totais de recebimentos.
- Histórico de NFs e lançamentos anteriores continua íntegro.
- Cópia anonimizada do banco e simulação de restauração antes de qualquer migration no banco principal.

## Limites assumidos

- Operadora, parecer e recuperação são informados **manualmente**; não há integração com portal da operadora.
- A classificação total/parcial é declarada pelo operador. Conferência automática com o valor de cada item faturado depende da disponibilidade de discriminação por procedimento.
- Glosas encerradas não são editadas/reabertas automaticamente; correções exigem procedimento administrativo auditável futuro.
- A Etapa 4 — Fechamento Mensal permanece independente e consolidada pela **PJ/PF recebedora** (não apenas por médico).
