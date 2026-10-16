# RN Integra — Etapa 5: auditoria e critérios de liberação

**Status:** somente revisão de código e verificações de leitura do banco. `main` atualizada. Nenhuma migration aplicada, nenhuma branch criada, nenhum ambiente pago contratado.

## Situação inicial validada

- Existem registros históricos reais de atendimentos, cobranças, NFs, itens fiscais e solicitações particulares. **Nunca tratar o banco como vazio.**
- Foram verificados em SQL somente leitura os vínculos cobrança→atendimento e cobrança→recebedora e casos simples de pagamentos particulares/NFs sem data ou líquido. A amostra atual não apresentou essas inconsistências específicas. Isso **não equivale** a teste de migração.
- A primeira migration continha um bloco PL/pgSQL iniciado com `do $ begin` em vez de `do $$ begin`; corrigido diretamente na `main`.
- As cinco migrations pendentes têm delimitadores de bloco balanceados na checagem lexical, que não substitui interpretação PostgreSQL ou validação de triggers.
- O deploy READY confirma que a aplicação compila, **não** que as migrations e as transações fiscais foram homologadas.

## Verificações sem custo extra

```bash
npm run test:billing-release
npx tsc --noEmit
npm run build
node --test tests/independent-professional-billing.test.mjs tests/professional-fiscal-flow.test.mjs
```

O último comando exige `@electric-sql/pglite` disponível em `node_modules`; seus testes exercitam parte do primeiro grupo de migrations com um esquema simulado. **Não confundir mocks com um clone do esquema PostgreSQL real.**

Consulta opcional sem escrita: `supabase/validation/financial-release-preflight-readonly.sql`. Ela não deve imprimir nomes de pacientes nem dados de documentos.

## Dependências e ordem das migrations

1. `20261016120000_independent_professional_billing.sql` — faturamento por profissional e preservação histórica.
2. `20261016183000_professional_private_fiscal_requests.sql` — emissão particular por cobrança e proteção clínica.
3. `20261016203000_billing_portal_submissions.sql` — guias enviadas ao portal e prazos.
4. `20261016220000_billing_denials_and_appeals.sql` — glosas, recursos, decisões e recuperação.
5. `20261016230000_monthly_entity_closing.sql` — fechamento consolidado e snapshots imutáveis.

A ordem depende da estrutura anterior. A execução real só ocorrerá **mediante autorização expressa em outra etapa**. Não aplicar as migrations do Perseu.

## Bloqueios atuais (NO-GO)

- Não foi homologada a aplicação das cinco migrations sobre um clone isolado do banco real.
- Não há comprovação de testes de integração **com os gatilhos e constraints reais** do Supabase: `financial_stamp`, `financial_log_change`, `fiscal_payment_integrity`, controle de solicitações e regras da agenda.
- Não houve teste completo com cirurgia contendo cirurgião e anestesista com cobradores, empresas e modalidades diferentes.
- Não houve simulação de restauração de backup/rollback operacional.
- Não foram validadas em navegador as rotinas gerenciais, permissões de secretaria e impressão do fechamento em PDF.

Até eliminar os bloqueios: **não ativar as flags**, não aplicar SQL em produção.

## Testes obrigatórios antes de liberar

1. Obter backup consistente e **verificar a possibilidade real de restaurá-lo**.
2. Aplicar migrations em banco isolado, com cópia anonimizada do esquema/dados e sem conexão aos serviços reais.
3. Conferir contagem e IDs de cobranças, NFs, solicitações, itens e comprovantes antes/depois; nenhum registro histórico duplicado, perdido ou reatribuído.
4. Testar o mesmo atendimento com cirurgião via convênio e anestesista particular, cada qual com PJ/PF distinta; emissor, pagador e status separados.
5. Testar duas solicitações particulares por cobrança; impedir duplicidade de pedido no mesmo `billing_record_id`.
6. Registrar nota única com muitos itens e profissionais; contabilizar **uma única entrada** no caixa da entidade.
7. Confirmar que secretária autorizada a um profissional não obtém dados financeiros do outro por UI ou API direta.
8. Apresentar guia com protocolo e data, sem quitá-la; testar prazos configurados e avisos de atraso.
9. Registrar glosa, recurso deferido parcialmente, recuperação e encerramento; não duplicar depósito.
10. Fechar mês passado de uma PJ/PF e conferir recebimentos por data de pagamento, NFs por emissão, produção por data clínica, despesas pagas e glosas.
11. Simular alteração posterior ao fechamento: mostrar divergência sem alterar snapshot.
12. Tentar atualizações concorrentes, IDs inválidos e edição fiscal já emitida; confirmar rejeição e auditoria.
13. Conferir build, permissões finais, navegação em celulares e PDF sem dados de outro médico.
14. Validar o processo de ativação e reversão por flags antes de liberar a operação.

## Ativação posterior e independente

As flags de ambiente do **servidor** permanecem ausentes/`false`, e só poderão ser usadas depois da homologação:

```env
RN_PROFESSIONAL_BILLING_ENABLED=true
RN_PORTAL_SUBMISSIONS_ENABLED=true
RN_DENIALS_ENABLED=true
RN_MONTHLY_CLOSING_ENABLED=true
```

Não configurar esses valores agora. Ativação de interface e aplicação das migrations são decisões distintas: uma não substitui a outra.

**Observação de engenharia:** a versão atual das migrations e os componentes são candidatos à homologação, não um pacote aprovado para uso financeiro real. O processo de revisão só termina após passar pelos testes transacionais no banco isolado e receber aprovação explícita.
