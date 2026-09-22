# Refinamento financeiro após dd563af

Mantém attendances, IDs financeiros, histórico, auditoria e isolamento por users.doctor_id.

- Empresa histórica (nome fantasia prioritário), ações compactas e impressão documental pela barra de filtros.
- Um helper de pendências compartilhado pela tela e relatório; filtro médico independente da empresa.
- Convênio histórico independente da cobrança, inclusive PARTICULAR; vazio explícito não recebe fallback do paciente.
- Especialidades centralizadas em lib/medical-specialties.json; anestesiologia dirige os seletores e agendas.
- category permanece DEPRECATED, derivada da especialidade para compatibilidade. Anestesistas legados recebem Anestesiologia. Especialidades livres antigas não são substituídas arbitrariamente; novas gravações exigem opção canônica.
- Despesas usam paid_by_doctor_entity_link_id, com FK ao vínculo histórico. Novos pagamentos exigem vínculo ativo da mesma empresa; históricos preservam vínculos inativos.
- company_associates e paid_by_associate_id permanecem DEPRECATED/read-only. Backfill somente quando existe um vínculo inequívoco; legados não resolvidos continuam consultáveis. Cadastro operacional de associados removido.
- Logs preservam a auditoria imutável, com DE/PARA responsivo e nomes históricos.
- Agenda+NF mantém landing na Agenda e consulta fiscal explícita somente leitura, sem totais/itens de terceiros.

## Migration

20260922130624_final_billing_refinements.sql. Reaplica funções com SECURITY INVOKER e execução restrita ao backend; backfills preservam autoria, sem inventar ator humano.

Compatibilidade especial: atendimentos antigos com convênio clínico vazio e NF vinculada permitem alterações não relacionadas sem preencher o vazio nem substituir o convênio financeiro histórico. Novos atendimentos CONVENIO continuam exigindo convênio.

## Validação

93 testes aprovados, incluindo migration real em PGlite, backfill resolvível/não resolvível, histórico, pagamento direto, isolamento fiscal, falha de auditoria e fontes financeiras. TypeScript e build aprovados. Lint sem erros (26 avisos existentes). Verificação visual com dados sintéticos em desktop/celular, impressão e logins médicos.
