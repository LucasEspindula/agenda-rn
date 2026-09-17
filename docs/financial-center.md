# RN Integra — centro financeiro dos atendimentos

## Fontes de verdade

- `doctors`: identidade profissional única. `doctor_agendas`: configuração de agenda, criada explicitamente.
- `users.doctor_id`: identidade opcional única, separada das permissões adicionais em `agenda_access`. Usuários médicos novos exigem médico existente. Contas legadas só são associadas automaticamente quando nome e permissão anterior identificam um único médico, sem colisões; casos ambíguos permanecem para associação explícita em Acessos.
- `billing_records.billing_entity_id`: entidade histórica do atendimento, independente de alterações posteriores nos vínculos.
- `invoices`: número fiscal, emissão, bruto/líquido e pagamento consolidados.
- `invoice_billing_records.received_amount`: valor individual opcional, informado manualmente. Ausência permanece NULL. Nenhuma diferença é distribuída.
- Para convênio agrupado, `billing_records.received_amount`, `paid_at` e `invoice_number` permanecem NULL. A API projeta o item e a NF ao consultar o atendimento; o status é sincronizado pela transação da NF.

## Fluxos

Atendimentos mantém a operação financeira. Os relatórios do médico (médico + período) e da empresa (entidade + período, todos os médicos) são documentos próprios, com resumo e subtotais. Usam atendimentos realizados e entidade histórica; o médico pode ter várias entidades. O consolidado conta cada atendimento uma única vez sob o responsável principal. Valores individualizados não são somados aos totais fiscais. A Relação de Notas Fiscais permanece independente.

Empresas e médicos contém entidades, vínculos e o mesmo componente/API do cadastro central. Cadastrar/Novo vínculo são ações da seção. As colunas Status/Ações têm larguras fixas à direita.

Cadastro profissional e criação opcional do acesso são atômicos. A senha é derivada no servidor com o PBKDF2 existente (SHA-256, 600.000 iterações, salt individual). Credenciais não entram em `doctors`, respostas de consulta ou auditoria. Atualizar acesso revoga sessões e preserva permissões adicionais quando a operação parte do médico.

A NF continua aceitando atendimentos realizados de convênio sem financeiro prévio; registros necessários são criados dentro da transação. Backend valida pagador, vínculo, existência, exclusividade e valores não negativos. Itens já vinculados conservam seu histórico e permitem atualização da NF mesmo após inativação do vínculo/empresa; novas associações exigem vínculos ativos. A auditoria registra valores individuais antes e depois.

## Migração e compatibilidade

Aplicar a migration `financial_center_and_doctor_access` após `invoice_direct_appointment_linking`. O arquivo versionado em `supabase/migrations` contém, em ordem, `financial-center.sql` e `doctor-access.sql`. Não recria médicos nem remove dados. Clientes antigos que omitem `item_amounts` preservam os valores já informados. Backups/rollback da aplicação não devem remover essas colunas ou apagar itens financeiros.

## Validação

- `npm test`: 59 testes, incluindo transações PostgreSQL/PGlite, permissões, relatórios e regressões existentes.
- `npx next build --webpack`: build e TypeScript aprovados. Webpack é usado apenas no ambiente local com dependências vinculadas; o comando de produção permanece `npm run build`.
- Chromium com dados fictícios: NF com dois médicos, valor informado e NULL, diferença sem rateio, seletor separado, edição posterior, valor bloqueado no financeiro, relatórios por médico/PJ, médico dentro do Faturamento e opção de login. Sem erros de execução no navegador.
- Casos de banco: médico com/sem login, login duplicado, rollback integral por e-mail duplicado, inexistência de agenda automática, incompatibilidade de atendimentos, valores negativos/inválidos, histórico após inativação e auditoria sem credenciais.
- API: secretaria consulta somente financeiro autorizado; projeção individual não expõe valores consolidados de outras pessoas.

Não foi implementada leitura/importação/OCR de PDF. Os valores individuais são manuais. Os testes interativos usam dados fictícios; não criam atendimentos ou NFs de teste na produção.
