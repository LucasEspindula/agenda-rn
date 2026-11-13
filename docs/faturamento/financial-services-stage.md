# Serviços médicos e centro financeiro independente da Agenda

Base: main `86fd2931661f7786f9b198d6160a5730b37c0a62`. Alteração aditiva; nenhum médico, paciente, faturamento, NF ou item histórico é recriado.

## Modelo

`doctors` possui três booleanos independentes: `scheduling_enabled`, `billing_enabled`, `invoice_enabled`. O padrão da migração é verdadeiro para preservar os serviços dos cadastros existentes. Inativar um serviço não remove dados.

`attendances` representa a ocorrência real. `appointment_id` é opcional e exclusivo; a origem distingue `AGENDA`, `FATURAMENTO_MANUAL` e `FISCAL_MANUAL`. Ocorrências legadas mantêm o ID do agendamento; registros manuais nunca entram em `app_state.appointments`. O paciente continua referenciado pelo ID do cadastro legado.

`billing_records.attendance_id` é obrigatório e exclusivo. Os IDs dos faturamentos existentes permanecem. `settlement_mode` distingue pagamento direto de pagamento pela NF. O responsável financeiro é fixado na ocorrência; um faturamento existente não muda de médico quando um vínculo médico/empresa muda. Para novos registros oriundos da Agenda, o anestesista pode ser identificado como recebedor quando somente ele possui vínculo com a entidade escolhida.

## Fontes financeiras

- Particular: pagamento individual no faturamento.
- Convênio sem gestão de NF: pagamento direto no faturamento, sem NF artificial.
- Convênio com NF: número/data/totais vêm da NF; valor individual vem exclusivamente do item opcional.
- A NF paga altera o status dos faturamentos vinculados, sem copiar os valores ou a data fiscal para eles.
- Não há rateio. Ausência de valor individual permanece NULL.

O relatório da PJ soma, por data de pagamento, os recebimentos diretos e o líquido de cada NF uma única vez. Itens não são somados ao caixa da NF. Despesas pagas são deduzidas; valores líquidos ausentes são sinalizados como resumo incompleto.

## Acesso

O servidor consulta os serviços atuais e `users.doctor_id` a cada sessão. Médico com Agenda entra em `/dashboard` e recebe 403 no faturamento administrativo; seu financeiro é consultado por paciente em endpoint próprio. Sem Agenda e com Financeiro, entra em `/billing`. Somente NF abre `/billing?view=invoices`. Sem serviço compatível, abre `/no-services`.

Todas as alterações financeiras são vedadas ao doctor. Sua leitura ignora parâmetros que tentem trocar o médico. NFs compartilhadas retornam somente seus itens, sem totais agregados nem notas administrativas. A leitura paginada completa dos itens impede classificar uma NF compartilhada como exclusiva por truncamento da consulta. Dados financeiros antigos da Agenda não são uma via alternativa de consulta para médicos.

## Autoria e auditoria

Triggers preservam `created_by/created_at` e atualizam `updated_by/updated_at` com o ator validado pela API/RPC. Pacientes legados recebem autoria sem recriação. Responsáveis antigos desconhecidos continuam desconhecidos.

Cada RPC estabelece uma operação transacional. `financial_logs` guarda o evento e o snapshot do nome/e-mail do ator; `financial_log_changes` guarda as alterações dos registros envolvidos. A interface agrupa as mudanças da mesma operação em DE/PARA. Nomes de referências relevantes também são preservados no snapshot. Senhas, hashes, salts e tokens não entram nos logs.

Triggers e privilégios vedam alterações, exclusões e TRUNCATE nos logs pela aplicação. Se a inserção do log falhar, a mutação também falha. A consulta de logs exige Gerente Geral no backend. Os filtros de médico/paciente/NF/ação refinam os eventos carregados; período, usuário e tipo limitam a consulta no servidor, com carregamento de eventos anteriores.

## Despesas e associados

`company_expenses` pertence à entidade recebedora. `company_associates` tem nome, atividade e vínculo opcional ao médico central. Despesa paga exige data e associado da mesma empresa, garantidos também por constraints. Associados são inativados; a aplicação não oferece exclusão física. Não há rateio, conta-corrente, recorrência, impostos automáticos ou DRE.

## Relatórios e validação

Os quatro relatórios reutilizam `BillingReport`: médico, PJ, NFs e pendências. Há pré-visualização documental separada com Voltar/Imprimir, papel A4 paisagem para as tabelas de oito colunas, margens, cabeçalhos repetidos e prevenção de quebra de linhas. Pendências incluem data/hora de emissão. A tela operacional não é impressa.

Testes adicionados cobrem os serviços, navegação, escopo por médico, NF compartilhada, ocorrências manuais, pagamento direto, valores NULL sem rateio, despesas/associados, autoria, imutabilidade, DE/PARA, rollback em falha de log e caixa sem dupla contagem. A suíte anterior permanece.

Os arquivos `supabase/next-stage*.sql` são os trechos fonte da migração, consolidados na migration executada pelo teste de banco. A migration versionada consolida exatamente esses trechos. A reversão da aplicação não deve remover tabelas ou histórico criados; faça rollback de código mantendo o schema aditivo.

### Evidências desta entrega

- 76 testes automatizados aprovados, incluindo execução integral da migration em PostgreSQL embarcado (PGlite).
- TypeScript sem erros; ESLint sem erros (26 avisos existentes/revisados).
- Build local pelo script npm com `--webpack`, necessário ao checkout que compartilha node_modules por symlink; o build padrão permanece inalterado para a Vercel.
- Chromium/Playwright com dados sintéticos: nove verificações de operação, leitura restrita, despesas, logs, navegação e responsividade. O ambiente de teste reutilizou explicitamente o cookie Secure emitido pelo login em contextos isolados.
- PDF de teste com sete páginas A4 paisagem: cabeçalhos de tabela presentes em todas as páginas, sem menus ou botões administrativos. Nenhum dado real foi usado nos testes de escrita/navegador.

Migration aplicada: `20260921132450_independent_medical_services_finance.sql`. Conferência posterior preservou os 3 faturamentos, 1 NF e 2 itens existentes; nenhum faturamento órfão e nenhuma ocorrência manual fictícia. As novas tabelas têm RLS, sem políticas públicas de acesso: apenas o backend autorizado usa o papel de serviço. O advisor retornou somente informações sobre esse bloqueio intencional, sem alertas de segurança.
