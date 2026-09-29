# Pendências de Convênio — visão operacional

Base: `37f8d589169089a7315d11952d3a41cee5650db6`.

## Escopo

Página de Pendências: empresa → convênio/pagador → atendimentos, sem edição inline. Empresas e atendimentos são ordenados pela pendência mais antiga. Cards e faixas 0–30, 31–60, 61–90 e +90 dias usam a data do atendimento e dias de calendário de São Paulo. A busca de paciente/procedimento ignora acentos e caixa. Os filtros não oferecem status; limpar filtros preserva as expansões.

O badge global e a lista partem de `isInsurancePending`. Cards e impressão geral usam os resultados filtrados. Empresas globalmente sem pendências aparecem em uma seção recolhível separada, não como resultado de filtros que apenas esconderam suas pendências.

## Fonte da fila

`lib/billing-row.ts:isInsurancePending` exige atendimento realizado e cobrança explicitamente CONVENIO. NF operacional ativa paga resolve; NF cancelada, substituída ou com lançamento desfeito não resolve. Pagamento direto resolve quando o registro tem `settlement_mode=DIRECT`, status PAGO, data e valor informado (zero continua sendo um valor válido).

A projeção existente de `loadBillingData` já seleciona somente vínculos `is_active`; nenhuma regra de vínculo foi duplicada na página. Os eventos financeiros e `financialRefresh` existentes atualizam a fila sem recriar a página. Expansões usam chaves estáveis de empresa/pagador e sobrevivem a filtros e refresh.

## Resolução

- Sem NF operacional: abrir escolha entre uma NF ativa compatível ainda não paga e criar nova NF. A elegibilidade usa `eligibleForInvoice`. Empresa e pagador são levados da pendência; o atendimento é selecionado automaticamente quando elegível. Vincular mantém os itens/valores anteriores e acrescenta o atendimento escolhido, sem rateio.
- NF ativa não paga: abrir o editor existente da NF.
- Pagamento direto: abrir o financeiro existente do atendimento, com entidade e forma de cobrança fixadas no contexto da fila.

No contexto da fila, os formulários de NF mantêm tipo, empresa já definida e pagador fixos. Paciente, médico e procedimento continuam sendo corrigidos na origem. Se uma ocorrência antiga não possui entidade, o fluxo de NF permite escolher a empresa e usar o seletor existente de atendimentos elegíveis; não é inferido um vínculo histórico a partir do cadastro atual do médico.

As APIs/RPCs, autorização e auditoria não foram alteradas. Não há migration, mudança de dados em produção, novo endpoint nem alteração no relatório/PDF fiscal geral de Notas Fiscais.

## Impressão

`app/billing/insurance-pending.tsx` compartilha a tabela entre a lista e a apresentação de impressão própria da fila. O botão do convênio imprime somente seus atendimentos atualmente filtrados naquela empresa. O botão geral imprime todos os resultados filtrados. A apresentação abre em diálogo nativo e oferece Imprimir/Voltar; CSS de impressão remove a aplicação, controles e fundos, repete cabeçalhos e evita dividir linhas.

## Validação em 29/09/2026

- `npm test`: 165 testes aprovados, incluindo seis novos testes de domínio da fila e as suites transacionais fiscais existentes. A fixture antiga de pagamento direto foi completada com data e valor para representar um pagamento efetivo.
- `npm run build`: aprovado.
- `npm run lint`: zero erros; 24 avisos preexistentes.
- Navegador Chromium com Next real e gateway local para PGlite, executando as migrations/RPCs existentes; apenas dados fictícios locais. O daemon de agent-browser não iniciou neste ambiente, então foi usado Playwright com Chromium.
- Desktop 1440px e mobile 390px: expansão empresa/convênio, ordem de antiguidade, cards, filtros combinados de empresa/médico/convênio/datas/busca, limpeza, badge global independente e seção sem pendências.
- Criar NF com atendimento selecionado; vincular à NF existente preservando item anterior; pagar NF remove seus dois atendimentos; registrar pagamento direto remove sua pendência com entidade bloqueada.
- Cancelar NF paga pelas RPCs existentes devolve seus atendimentos; desfazer lançamento restaura a ação de criar/vincular; substituir NF paga por NF não paga devolve a pendência; pagar a substituta resolve novamente.
- Refresh mantém expansão e filtros. Impressão por CABERGS contém só três atendimentos desse grupo; impressão geral filtrada por procedimento contém só o resultado selecionado. PDF renderizado e inspecionado, sem menus/filtros/ações.
- Zero erros JavaScript no navegador. Sem alteração de permissões, dados sintéticos em produção ou refinamentos externos ao escopo.
