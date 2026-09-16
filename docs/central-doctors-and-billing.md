# Cadastro central e faturamento

`doctors` é a fonte única de nome, CRM/UF, especialidade, categoria e situação do médico. Os IDs anteriores foram mantidos. O cadastro de um médico não cria uma agenda.

`doctor_agendas` referencia `doctors.id` por `doctor_id` e contém ativação e configurações de expediente. As regras de bloqueio e atendimentos existentes continuam referenciando o mesmo ID; não foram recriados. `/doctors` tem abas separadas de Médicos e Agendas. Os acessos em Agendamento e Faturamento apontam para essa página.

O cliente antigo da agenda ainda lê `app_state.payload.professionals`. Esse campo é uma projeção de compatibilidade, reconstruída pelo banco a partir de `doctors` e `doctor_agendas` em cada atualização. Não é um segundo cadastro editável. Atualizações do cadastro central invalidam a revisão de `app_state`, propagando alterações para o fluxo existente de atualização em tempo real. O endpoint da agenda também ignora tentativas de editar o cadastro nessa projeção.

## Notas e vínculo financeiro

`invoices → invoice_billing_records → billing_records → appointment_id`.

A tabela associativa possui ID próprio, referência à NF e referência ao faturamento. Um faturamento não pode pertencer a duas NFs. Uma NF pode ser salva como rascunho sem itens; confirmar pagamento exige pelo menos um item. Novos vínculos exigem atendimento realizado, cobrança CONVENIO, status PENDENTE, entidade e pagador compatíveis e ausência de outra NF. O período é um filtro de seleção, não um limite permanente da nota. Itens já vinculados continuam editáveis quando pagos.

O número da NF e a data de pagamento de convênio são obtidos pela associação; valores brutos/líquidos ficam somente na NF. Não há rateio automático. A gravação da NF, de seus itens, do status financeiro e da auditoria é atômica. PARTICULAR mantém campos individuais.

## Exclusões e permissões

Gerência pode excluir vínculo médico–entidade, preservando a entidade já registrada em faturamentos históricos. Uma entidade só pode ser excluída sem vínculos, NFs ou faturamentos; caso contrário deve ser inativada. Confirmações usam diálogo central nativo HTML, sem `alert`/`confirm` do navegador. Edições/exclusões exigem a revisão atual, evitando sobrescrever alterações concorrentes.

As funções de cadastro central são restritas ao servidor, validam gerente no banco, usam trava transacional e registram antes/depois. As novas tabelas têm RLS e não concedem acesso a anon/authenticated. Criação de novos atendimentos valida o cadastro central e exige uma agenda ativa.

## Verificação

`node --test tests/billing-database.test.mjs tests/state-sync.test.mjs` cobre migração, permissões, baixa agrupada sem rateio, rejeição de vínculo inelegível, exclusão protegida, preservação histórica, criação independente de médico e agenda, proteção da projeção central e conflitos de revisão.

`npx next build --webpack` valida compilação e TypeScript. No ambiente local, webpack é utilizado porque node_modules é um link externo; o build da Vercel mantém a configuração habitual.
