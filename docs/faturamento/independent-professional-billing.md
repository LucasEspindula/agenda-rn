# Cobranças independentes por profissional

## Modelo

`attendances` continua sendo a origem clínica. Cada linha de `billing_records`
passa a representar uma cobrança profissional identificada por
`(attendance_id, professional_id)`. A cobrança registra separadamente a
entidade recebedora, forma de cobrança, modalidade comercial, canal de
apresentação, pagador/intermediário efetivo e snapshots históricos necessários
para leitura financeira.

`billing_commercial_modalities`, `billing_submission_channels`,
`billing_counterparties` e `billing_professional_commercial_rules` são tabelas
de configuração. A última é versionada por vigência e não escolhe cooperativas
por especialidade: qualquer profissional pode ter uma regra própria.

## Migração segura

1. Aplicar `20261016120000_independent_professional_billing.sql` primeiro em
   Preview/homologação. Ela é aditiva e **não** apaga registros, NFs, itens de
   NF, pagamentos ou logs.
2. Os registros existentes recebem o médico clínico como `professional_id`,
   `PRIMARY` como papel e códigos `LEGADO` onde não é seguro inferir a
   modalidade/canal histórico.
3. Somente depois da conferência do Preview liberar a migration em Produção.
   Esta entrega não executa migrations em Produção.
4. Validar um atendimento simples, dois profissionais no mesmo atendimento,
   pagamento direto de apenas um profissional e uma NF de convênio com vários
   `billing_records` antes de uso operacional amplo.

## Limites desta etapa

Não há conciliação automática, glosa, fechamento mensal, integração de portal
ou mudança automática de pagamentos. O envio de uma cobrança para o portal do
convênio continua sendo o próximo incremento, distinto de pagamento.
