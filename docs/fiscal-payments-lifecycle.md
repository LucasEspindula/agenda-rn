# Refinamento fiscal e pagamentos

Base main: a31462ec0afcdeb86c311eec9317cd3ac0f1531b. Migration nova: `20260925173355_fiscal_payments_lifecycle.sql`. Migrations anteriores preservadas.

## Dados e operações

`payment_parts` pertence exclusivamente ao registro Particular ou à NF Convênio. Crédito exige parcelas inteiras >= 1, mantendo um único valor de recebimento. Valores são normalizados uma vez com arredondamento decimal, armazenados em numeric(12,2) e comparados em centavos exatos. As partes somam o recebimento Particular ou o líquido da NF Convênio paga.

Convênio exige valor em cada item. Soma dos itens + closing_adjustment = net_amount. Ajustes positivos/negativos exigem justificativa e não são distribuídos ao médico. Não há rateio automático.

Desfazer lançamento interno usa voided_at/by/reason, mantém documento e itens históricos, retira o vínculo operacional e permite recadastrar o número da entrada equivocada. Cancelamento fiscal usa CANCELLED com data/autor/motivo, sem apagar o documento. Substituição cria uma nova ACTIVE e marca a antiga REPLACED, com relação sem ciclos. Todas são transacionais, restritas à gerência e auditadas.

No máximo um vínculo ativo por billing_record, usando índice parcial sobre is_active. Convênio cancelado/desfeito volta a PENDENTE. Particular conserva pagamento e reabre a mesma request PENDING, sem alterar snapshot; substituição aponta essa mesma request à nova NF. Nenhuma dessas operações cria novo recebimento Particular.

Atendimento FATURAMENTO_MANUAL/FISCAL_MANUAL pode ser cancelado logicamente, com motivo/autoria. NF ativa bloqueia. Sem NF ativa, a operação cancela request pendente, cancela atendimento e neutraliza o financeiro operacional; os valores anteriores permanecem na auditoria. Agenda mantém seu próprio cancelamento. Não há reativação.

## Legado e segurança

Invoicing existente recebe ACTIVE/ajuste zero. allocation_verified e payment_composition_verified ficam false nos registros anteriores que precisam de revisão. Não se inventam dados nem se interpretam textos para criar formas de pagamento. Novos documentos e alterações passam pelas validações estritas; checks distinguem violações operacionais de revisão legada conhecida.

SECURITY INVOKER, service_role no backend, RLS sem policies públicas novas e autoria obtida da sessão. Secretaria continua restrita ao pagamento Particular autorizado. Médico continua somente leitura, sem CPF/endereço fiscal e composição de terceiros.

## Interface

PATIENT usa nome canônico e campo somente leitura; backend ignora adulteração inicial. Solicitações já confirmadas conservam seus snapshots. CPF continua opcional no cadastro, obrigatório na confirmação fiscal. Fila da gerência exibe CPF completo e só repete Tomador quando OTHER.

Submenu Solicitações/Notas emitidas antecede filtros. Contador usa a mesma fonte. Refresh silencioso mantém conteúdo, filtros e aba; requisições simultâneas deduplicadas, foco com 30 segundos de validade, BroadcastChannel mantido.

Médicos remove a aba Agenda intermediária, preservando calendário direto por médico e botões lado a lado. Navegação e ações usam SVGs consistentes.

Fontes de dados excluem documentos não ativos de totais/distribuição. Pagador é tomador fiscal ou convênio, Referente a são procedimentos, Sócio vem dos itens, Emitido por vem de created_by. Ajuste é separado. O layout de impressão/PDF não foi redesenhado.

## Validação

Testes locais PGlite e navegador usam dados fictícios exclusivamente locais. Resultados finais, checks de produção e hashes serão acrescentados ao concluir a validação.

### Resultado final — 29/09/2026

- `npm test`: 159 testes aprovados, zero falhas.
- `npm run build`: aprovado. `npm run lint`: zero erros, 24 avisos preexistentes.
- Navegador local real com Next + RPCs PostgreSQL/PGlite: Particular em 1440 e 390 px (PIX 1000 + crédito 1000/4x, CPF, nome canônico, emissão, edição, desfazimento e mesma request reaberta); Convênio desktop/mobile (600/400, pagamento 1000, cancelamento, retorno às pendências e substituição); manual criado/cancelado consultável; configuração direta de agenda; ações lado a lado. Sem erros JavaScript. Segunda aba recebeu BroadcastChannel, enquanto edição local fez um único fetch e preservou a subguia.
- Migration aplicada em produção sob versão `20260929141601`, nome `fiscal_payments_lifecycle`. Nenhum dado sintético em produção.
- 13 checks operacionais com zero violações, incluindo cardinalidade Particular, duplicidade ativa, órfãos, ciclo de substituição, pagamento/request, distribuição/composição verificadas e cancelados com vínculo ativo.
- Revisão legada explícita: 1 NF de Convênio para conferir distribuição e composição; 1 pagamento Particular para confirmar composição. Nenhum valor/método inventado.
- RPCs conferidas: SECURITY INVOKER, anon/authenticated sem execução, service_role autorizado. RLS mantida.
- Security advisor: zero WARN/ERROR; 25 INFO por RLS sem policies, intencional nesta arquitetura exclusivamente backend.
- Performance advisor: permanecem os mesmos 4 WARN de índices duplicados anteriores à tarefa; nenhum novo. Permanecem 36 INFO de FKs antigas sem índice; índices novos ainda não usados aparecem como INFO. Não foram removidos índices de módulos fora do escopo. [Orientação do advisor sobre duplicatas](https://supabase.com/docs/guides/database/database-linter?lint=0009_duplicate_index).

Contagens e hashes das colunas históricas, idênticos antes/depois (colunas novas excluídas da comparação):

| Tabela | Registros | MD5 |
|---|---:|---|
| invoices | 1 | 7894346d03b9a8a1dc977b7fd95fa12b |
| billing_records | 4 | a5272a878d6732c84b18d7d8e536bfb9 |
| invoice_billing_records | 1 | 31c80bccdc2afc40163d72ae9c1ba461 |
| attendances | 4 | 82f30f3122c3830397c1ac6e0c364ed1 |
| invoice_requests | 1 | 50326c182a0066e92166162f3c20766f |
| app_state | 1 | cdc172b8a31b8a74b81dc179dc176c4b |

Principais funções: save_billing (orquestração), save_billing_fiscal_core (regras atuais reutilizadas), write_payment_parts, cancel_manual_attendance, finish_private_payment, save_private_invoice, protect_invoice_request, protect_fiscal_document, check_fiscal_integrity, guard_invoice_appointments e save_manual_attendance. Auditoria imutável existente reutilizada.
