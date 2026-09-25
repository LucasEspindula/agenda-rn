# Solicitações de NF e documentos fiscais universais

Base: main `62d068516e9b54d07f4e1722563f0b2d10c18d82`, após a etapa estrutural e sua migration `scheduled_private_payment` aplicada.

## Banco e autoria

Migration incremental `20260924191510_invoice_requests_universal_fiscal.sql`. Nenhuma migration anterior foi editada.

- `invoice_requests`: vínculo obrigatório ao atendimento, financeiro e empresa; snapshots de paciente, médico, procedimento, empresa, tomador, CPF, endereço, observação, valor e pagamento; autores e timestamps; status PENDING/ISSUED/CANCELLED; invoice_id único.
- Índices únicos parciais impedem duas obrigações ativas para o mesmo atendimento ou financeiro. Snapshot imutável; correção antes da emissão ocorre por cancelamento/reconfirmação, conservando o registro anterior.
- `invoices`: recipient_type (CONVENIO/PARTICULAR), recipient_kind/name/tax_id/address, patient_id e patient_name_snapshot. As notas particulares usam o vínculo existente `invoice_billing_records`.
- Constraints diferidas validam exatamente um atendimento e uma solicitação emitida por NF particular, método compatível e recebimento coerente. CPF validado por dígitos verificadores no banco e na interface.
- `save_billing` mantém autorização, locks transacionais, SECURITY INVOKER e a operação única de auditoria. Helpers novos: valid_cpf, prepare_private_payment, finish_private_payment, save_private_invoice, protect_invoice_request e check_fiscal_integrity. `guard_invoice_appointments` diferencia notas particulares de convênio.
- RLS habilitado na nova tabela sem policies públicas; somente service_role recebe acesso. Funções não acessíveis a anon/authenticated. Auditoria usa os triggers imutáveis de financial_logs/financial_log_changes já existentes.

## Fluxos

Particular: Secretaria/Gerência informa valor e data em billing_records. Antes de confirmar Pago, janela compartilhada exige nome/CPF do tomador; endereço e observação são opcionais. Próprio paciente preenche dados disponíveis e grava CPF ausente/endereço informado no cadastro; Outra pessoa preserva o paciente. O CPF é opcional no cadastro normal. Cadastro de pacientes continua no app_state existente.

Pagamento e solicitação são gravados pela mesma RPC/transação. Retry idêntico reutiliza o resultado, inclusive com token antigo do duplo clique. Reversão antes da emissão cancela a solicitação; reconfirmação cria novo snapshot sem duplicidade ativa. Após emissão (inclusive número legado), alteração financeira comum é bloqueada com orientação para correção fiscal/manual. Não há exclusão automática de documentos.

Gerência autorizada processa Solicitações → Registrar NF. Empresa, tomador e atendimento são fixados pelo snapshot. Número/data/valores/observação fiscal criam a invoice, vínculo e status ISSUED atomicamente. NF particular contém exatamente um atendimento também no backend.

Convênio mantém seleção de empresa/convênio e múltiplos atendimentos realizados compatíveis. Um atendimento Particular não é elegível apenas por conter CABERGS no cadastro. Sem rateio automático.

Notas Fiscais contém Solicitações e Notas emitidas. Os dois badges usam a mesma coleção/count de PENDING; zero não mostra badge. Atualização após gravação, foco e BroadcastChannel entre abas. Notas emitidas inclui ambos os tipos. CPF parcialmente mascarado na fila e integral somente na operação autorizada. Médico mantém projeção read-only, sem fila ou CPF/endereço fiscal (inclusive na resposta da Agenda); Secretaria não recebe acesso à emissão nem ao número de NF no editor financeiro.

## Legado e relatórios

Não se infere tomador/CPF de um cadastro atual para documentos antigos. Nenhuma invoice ou solicitação é materializada automaticamente. `billing_records.invoice_number` permanece preservado e deprecated. A fila mostra seção separada de revisão dos pagamentos anteriores; registros com NF legada exigem conferência documental. Registros pagos sem número podem ter seus dados fiscais explicitamente confirmados.

Particular continua contabilizado exclusivamente pelo recebimento em billing_records, mesmo depois de emitir NF. Somente invoices de convênio entram na parcela de receitas por notas do caixa. Criar solicitação não gera receita. Produção mantém a data do atendimento; recebimento, a data do pagamento. Logs descrevem confirmação/solicitação, cancelamento e emissão, com snapshots históricos.

## Verificação

Testes automatizados de domínio e PGlite cobrem CPF, opcionais, próprio paciente/outro tomador, atomicidade, idempotência, constraint de unicidade, snapshot imutável, cancelamento/reconfirmação, emissão/vínculo, reversão bloqueada, segundo item particular rejeitado, múltiplos itens de convênio, preservação do legado, privilégios e receita sem duplicidade.

Fluxos de navegador executados com aplicação Next real, APIs reais e banco PGlite com migrations, usando exclusivamente dados fictícios. Desktop 1440px e mobile 390px: Agenda → Particular R$ 1.500 → CPF ausente bloqueado → confirmar → badge 1 → Registrar NF 100 → badge oculto → Notas emitidas. Convênio CABERGS → dois atendimentos elegíveis → NF 200. Secretaria sem acesso à fila geral/emissão. Sem erros de JavaScript. Screenshots revisados; o CLI agent-browser não iniciou seu daemon neste runtime, então a verificação completa foi concluída com Playwright/Chromium.

Verificação de produção usa somente metadados, contagens e hashes antes/depois, além de `supabase/checks/invoice_requests.sql`. Nenhum dado fictício é inserido em produção. “Fechar período” não foi implementado.

Resultado local final: `npm test` — 144 testes aprovados; `npm run build` — aprovado; `npm run lint` — zero erros, 24 avisos preexistentes.

## Supabase em produção — 25/09/2026

Migration aplicada com sucesso pelo serviço, versão registrada `20260925115826`, nome `invoice_requests_universal_fiscal` (o arquivo incremental mantém seu timestamp de criação).

Hashes e contagens anteriores/posteriores idênticos: 2 billing_records, 1 invoice, 1 vínculo invoice_billing_records e 1 app_state. Para invoices, a comparação exclui somente as sete colunas adicionadas pela migration. Nenhum payment_status ou documento anterior foi alterado/apagado.

As cinco verificações de integridade retornaram zero: duplicidade ativa, quantidade de itens da NF particular, solicitação emitida sem invoice, solicitação pendente incompatível com pagamento e incompatibilidade de tipo de tomador. Sete funções verificadas com SECURITY INVOKER, execução negada a anon/authenticated e permitida a service_role. Nova tabela com RLS, sem acesso público e sem policies arbitrárias.

Advisor de segurança: somente INFO de RLS habilitado sem policy nas 24 tabelas (incluindo a nova), conforme arquitetura exclusivamente server-side/service_role. Sem WARN/ERROR. Referência: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
