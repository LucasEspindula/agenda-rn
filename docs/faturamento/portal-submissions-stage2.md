# RN Integra — Etapa 2: Guias e faturamento no portal

## Fluxos distintos

- **Pendente de pagamento** segue em `Faturamento > Convênios > Pendências de pagamento` e consulta os registros financeiros e NFs. Não é substituído.
- **Aguardando envio** é a situação inicial da guia. O pagamento pode estar pendente ou pago sem determinar sua apresentação no portal.
- **Faturado no portal** significa que alguém registrou manualmente a data real do envio e o protocolo, após o recebimento da guia. **Não altera `billing_records.payment_status`, data de pagamento, valores ou NF.**
- **Alertas de prazo** são calculados na consulta usando a regra do destino, canal, profissional e vigência. O prazo não é configurado universalmente; nenhuma regra para UNIMED, COOPA ou outros foi criada automaticamente.
- **Sem regra** significa que não é possível afirmar se a guia está no prazo. Uma regra que começa no recebimento exige `guide_received_at` antes de calcular a data-limite.

## Funcionalidade preparada no GitHub / main

- `lib/portal-deadlines.js`: datas civis e estados de prazo, com testes em `tests/portal-deadlines.test.mjs`.
- `app/billing/portal-submissions.tsx`: fila operacional, status, filtros e alertas visíveis.
- `app/billing/portal-guide-dialog.tsx`: registro da guia, data de recebimento e envio com protocolo.
- `app/billing/portal-rule-manager.tsx`: gerência cria regras por destino, canal, profissional opcional e vigência.
- `app/api/billing/portal/route.ts`: API com filtro por profissional, checagem de autorização na escrita e controle independente do financeiro.
- `app/billing/portal/page.tsx`: acesso exclusivo para gerência e secretaria com agendas autorizadas.
- `supabase/migrations/20261016203000_billing_portal_submissions.sql`: tabelas e RPCs, rastro imutável de eventos de submissão.

A secretaria só enxerga guias de cobranças vinculadas a profissionais autorizados nas suas agendas, não ganha acesso ao Faturamento gerencial. A gerência configura prazos, mas a secretaria pode registrar a apresentação real. Uma guia já marcada FATURADO fica somente leitura para evitar reversões sem auditoria formal.

## Dependências para ativação

Executar nesta ordem **somente após homologação**, em um banco não produtivo isolado:

1. `20261016120000_independent_professional_billing.sql`
2. `20261016183000_professional_private_fiscal_requests.sql`
3. `20261016203000_billing_portal_submissions.sql`

O módulo está **desabilitado por padrão**. Somente após sucesso de migração e testes funcionais, configurar no ambiente servidor:

```env
RN_PORTAL_SUBMISSIONS_ENABLED=true
```

A ativação financeira profissional anterior permanece independente (`RN_PROFESSIONAL_BILLING_ENABLED`), também protegida.

## Cenários obrigatórios de homologação

1. Dia 1: procedimento. Prazo contratual hipotético de 30 dias corridos e alerta 5 dias antes: mostrar alerta quando restarem 5 dias; somente se gerência cadastrou essa regra.
2. Recebimento posterior da guia com regra ancorada no recebimento: antes disso, exibir Aguardando guia em vez de vencido.
3. Marcar FATURADO com data e protocolo; pagamento permanece PENDENTE.
4. Envio incompleto, data futura ou protocolo ausente deve ser recusado sem registro parcial.
5. Cirurgião por convênio e anestesista particular: somente cobrança conveniada aparece na fila.
6. Duas cobranças conveniadas do mesmo atendimento permanecem separadas e não podem compartilhar protocolo sem registro individual.
7. Secretaria sem permissão ao profissional recebe 403 e não enxerga seus registros; gerência pode consultar.
8. Regra geral e regra específica: a regra específica prevalece se vigente. Regra sobreposta do mesmo contexto deve ser recusada.
9. Faturamentos históricos e NFs permanecem íntegros, sem alteração do status de pagamento.
10. Eventos de configuração, recebimento de guia e faturamento são persistidos com autor e data.

## Limites intencionais desta etapa

- Envio é marcado **manualmente**. Não há conexão com portais de operadoras nem comprovação automática de envio.
- Alertas são **visuais na tela**, recalculados quando a página é consultada; não há aviso por push, WhatsApp ou e-mail.
- Na primeira versão, regras aceitam **dias corridos**. Dias úteis e feriados contratuais exigem calendário validado antes de calcular alertas para esse tipo de regra.
- Regras são versionadas por intervalo de vigência e não são editadas retroativamente. Para inserir uma nova regra, a vigência não pode sobrepor outra da mesma combinação.
- Guias já faturadas não são alteradas diretamente; eventual correção administrativa auditável é evolução futura.
- O Fechamento Mensal continuará por PJ/PF; esta etapa não antecipa relatórios de glosa ou fechamento.

**Não aplicar no banco produtivo nem habilitar a flag sem testes de migração e permissões.**
