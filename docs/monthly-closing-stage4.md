# RN Integra — Etapa 4: Fechamento mensal consolidado por PJ/PF

**Situação:** código entregue na `main`. Nova migration **não aplicada**. Módulo fechado por flag até homologação. Sem branch paga e sem alterações financeiras no banco.

## Princípio de cálculo

O **filtro principal sempre é a entidade recebedora histórica**, `billing_records.billing_entity_id` e `invoices.billing_entity_id`. O fechamento agrega os profissionais que tenham faturamento atribuído a essa PJ/PF naquela competência, ainda que o médico atualmente esteja associado a outra entidade. Nenhum vínculo atual é usado para reatribuir faturamento antigo.

A competência (AAA-MM) é a referência do relatório, mas métricas distintas possuem datas distintas:

| Métrica | Fonte da verdade | Data utilizada |
| --- | --- | --- |
| Atendimentos realizados e cobranças por profissional | `attendances` + `billing_records` | Data do atendimento |
| Valores individuais atribuídos aos profissionais | `invoice_billing_records` (itens ativos de NF CONVÊNIO) | Data do atendimento |
| NFs emitidas, bruto e líquido | `invoices` ativas, deduplicadas por `id` | Data de emissão |
| Recebimento particular/direto | `billing_records` com `settlement_mode=DIRECT` e `PAGO` | `paid_at` |
| Recebimento de convênio | `invoices` ativas CONVÊNIO, **uma vez por NF**, independentemente dos itens | `paid_at` |
| Despesa da competência | `company_expenses` | `competence_date` |
| Despesa efetivamente paga | `company_expenses` com status `PAGO` | `paid_at` |
| Glosas recebidas do pagador | `billing_denial_cases` | Data da glosa |
| Recuperações operacionais de glosa | `billing_denial_recoveries` | Data da recuperação |

**Não somar os valores de itens dos médicos ao valor líquido das NFs no fluxo de caixa**. O valor de uma NF compartilhada entra uma única vez como recebimento da PJ/PF. A NF PARTICULAR não cria segunda entrada se o honorário direto já está em `billing_records`. Glosa recuperada também não gera automaticamente pagamento; o recebimento é registrado na fonte financeira própria.

## Recursos implementados

- Seleção por **PJ/PF** e **competência mensal**; todas as cobranças são filtradas pelo identificador de entidade gravado no faturamento.
- Visão da produção por profissional; contagem de atendimentos, cobranças particulares e por convênio; identificação de itens e pendências.
- NFs do mês, pagamentos diretos, depósitos consolidados de convênio, despesas e glosas, com os respectivos detalhes.
- Resultado de caixa em centavos: **pagamento direto + NF CONVÊNIO paga - despesas pagas**.
- Faturamentos sem valor individual identificado e NFs sem valor líquido aparecem como avisos, sem imputar valores fictícios.
- Fechamento formal somente para competência anterior ao mês atual; impede fechamento com NF sem valor líquido.
- Snapshot imutável e exclusivo por `billing_entity_id + competence_month`, com autor, data e observação.
- Comparação entre retrato histórico e posição atual, sem sobrescrever o primeiro quando houver lançamentos posteriores.
- Impressão e salvamento em PDF pelo navegador.

A posição de pendências e glosas encerradas apresentada na prévia é a **situação atual**, não uma reconstrução histórica. O snapshot salva esse estado no momento do fechamento.

## Implementação

- `supabase/migrations/20261016230000_monthly_entity_closing.sql`: resumo transacional calculado pelo banco e tabela histórica imutável.
- `app/api/billing/closing/route.ts`: endpoint restrito ao gerente geral, com prévia e fechamento, protegido por autenticação e origem para escrita.
- `app/billing/fechamento/page.tsx`: entrada gerencial isolada.
- `app/billing/monthly-closing.tsx` + CSS: formulário da entidade, métricas, detalhamentos, histórico e impressão.
- `lib/monthly-closing-math.js`: cálculo do resultado líquido em centavos.
- `tests/monthly-closing-math.test.mjs` + `tests/monthly-closing-contract.test.mjs`: testes isolados/contratos de segurança.

A ativação depende da flag de servidor `RN_MONTHLY_CLOSING_ENABLED=true`. Ausente ou diferente de `true`, o menu fica oculto e o endpoint retorna 404.

## Migrations pendentes em ordem

1. `20261016120000_independent_professional_billing.sql` — cobrança por profissional.
2. `20261016183000_professional_private_fiscal_requests.sql` — solicitação particular independente.
3. `20261016203000_billing_portal_submissions.sql` — guias, apresentação e alertas.
4. `20261016220000_billing_denials_and_appeals.sql` — glosas e recuperações.
5. `20261016230000_monthly_entity_closing.sql` — fechamento mensal por PJ/PF.

Não aplicar no banco principal antes de homologar as cinco em ordem, testando a migração dos dados históricos em uma cópia isolada. As migrations do Perseu não fazem parte deste pacote.

## Cenários indispensáveis de homologação

1. Uma NF CONVÊNIO de R$ 1.000 paga para uma PJ/PF e vinculada a três profissionais: **recebimento total R$ 1.000, não R$ 3.000**.
2. Dois médicos do mesmo atendimento, entidades recebedoras diferentes: cada competência da PJ/PF tem somente suas cobranças.
3. Profissional que troca de empresa: mês histórico continua vinculado à PJ/PF gravada no faturamento.
4. Atendimento em setembro, NF em outubro e depósito em novembro: métricas aparecem nas respectivas competências e datas.
5. NF PARTICULAR emitida sobre pagamento direto: não duplicar receita.
6. Glosa recuperada associada a NF já paga: recuperação não entra novamente como caixa.
7. Despesa registrada em setembro e paga em outubro: apenas outubro sofre dedução de caixa.
8. Gerente geral autorizado, secretária/médico com acesso negado ao fechamento consolidado.
9. Competência futura/atual não fecha; mês anterior fecha uma única vez; tentativa repetida falha.
10. Após fechar, uma mudança de lançamento no banco provoca **indicação de divergência**, sem mudar o snapshot histórico.
11. NF paga sem líquido identificável impede fechamento até correção.
12. Impressão com CPF/CNPJ, dados por profissional e discriminações; verificar apresentação e proteção de dados.

## Limites assumidos

- O fechamento **não movimenta dinheiro**, não cria NF, não quita glosa e não altera pagamento.
- Não há integração contábil automática ou certificação fiscal; impressão serve como relatório gerencial.
- A retificação de um fechamento histórico imutável exigirá fluxo administrativo auditado futuro.
- Os testes de banco dependem da aplicação isolada das migrations; **build READY não é prova de homologação da escrituração**.
