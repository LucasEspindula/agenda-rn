# Navegação e experiência financeira

Entrega incremental sobre `e2e2ad9`, sem fluxo de Solicitação de NF.

## Organização

- O cabeçalho global tem dimensões e tipografia próprias e reserva espaço para a barra de rolagem; os módulos não sobrescrevem seus estados ativos.
- Faturamento e Médicos usam submenus brancos com seleção em verde-azulado.
- Atendimentos, NFs, pendências e despesas usam uma barra de filtros comum, com ações compactas à direita. O status é calculado pela mesma função na tabela, nos filtros e nos relatórios.
- Médicos reúne **Médicos / Agenda / Hospitais / Empresas e vínculos**. Os editores de entidades e vínculos são os mesmos do financeiro, sem duplicar cadastros.
- A configuração da agenda reúne expediente, ativação, todas as regras existentes e bloqueios pontuais do médico. A atualização do expediente sincroniza a revisão do editor de regras.
- Hospitais mantém o cadastro compartilhado, permite editar o nome e impede excluir hospitais presentes em agendamentos, cancelamentos ou regras.
- Configurações apresenta exclusivamente acessos administrativos de gerência e secretaria; acessos médicos continuam no cadastro do médico.

## Agendamento e valores

O modal tem cabeçalho e rodapé estáveis e uma área interna de rolagem, limitado à altura da tela. O iframe foi substituído por campos nativos que usam `/api/billing` e as regras financeiras compartilhadas.

Selecionar Particular mostra valor, status e data imediatamente. Alternar temporariamente para Convênio preserva o rascunho Particular. Convênio/plano continua independente da forma de cobrança. Pagamentos vinculados a NF são somente leitura, incluindo número, valor individual, data e status, sem campos novos de emissão para a secretaria.

`formatBRL`, `parseBRL` e `MoneyInput` centralizam apresentação e entrada: `R$ 1.500,00` vira o número `1500`, vazio permanece `NULL`, zero continua zero. A persistência continua em `billing_records.received_amount`; valores individualizados de convênio continuam nos itens da NF. Nenhum rateio foi adicionado.

A consulta escopada pode projetar um agendamento autorizado ainda não realizado sem gravar nada. A migration incremental `20260924024434_scheduled_private_payment.sql` permite materializar seu atendimento financeiro somente ao salvar um Particular autorizado. Ela preserva os bloqueios, validações, permissões, autoria, controle de concorrência e a operação de auditoria da função existente. Gravações inválidas revertem atendimento e financeiro juntos. Realizar o atendimento posteriormente não cria duplicata.

O salvamento clínico e o financeiro continuam em chamadas separadas: primeiro a agenda é confirmada, depois o pagamento. Se a segunda etapa falhar, a tela informa que o agendamento foi salvo e mantém o formulário financeiro para correção. Não há mensagem de sucesso financeiro antes da confirmação do servidor.

## Histórico e relatórios

O histórico financeiro apresenta uma linha cronológica por operação, com frase de autoria, data, perfil e DE/PARA compactos. Nomes disponíveis substituem identificadores e valores monetários usam BRL. Os logs persistidos não são reescritos. O perfil exibido vem do cadastro atual; os logs anteriores não possuem snapshot histórico do papel.

Os relatórios respeitam filtros de status, pagador, empresa, médico e período. O resumo de caixa integral da empresa permanece disponível quando não há filtros adicionais de médico, pagador ou status, evitando misturar um total integral com linhas filtradas.

## Validação

- `npm test`: **129 testes aprovados**, sem falhas. Cobertura inclui BRL/NULL/zero, filtros versus relatórios, projeção escopada sem gravação, negação de acesso, rollback, concorrência, auditoria e ausência de duplicação após realização.
- `npm run build`: aprovado.
- `npm run lint`: **0 erros, 24 avisos remanescentes**; base anterior: 26. Nenhuma nova categoria de aviso; o aviso do stylesheet legado foi concentrado no componente compartilhado.
- Navegador com contas fictícias, APIs reais do Next.js e funções SQL executadas em PGlite: cabeçalho estável em 1366×768, 1920×1080 e 390×844; modal também em 768×1024, com botões inteiros dentro do painel; configuração de agenda/regras, hospitais, empresas/vínculos, Particular em agendamento existente e novo, alternância de cobrança, filtros, impressão, NF e despesas em BRL, histórico desktop/mobile e edição pela secretaria. **Nenhum erro JavaScript de página.**
- Testes não alteram dados de produção. A migration altera somente a função; não faz backfill ou exclusão de dados.

## Arquivos principais

`app/hub/hub.css`, `app/globals.css`, `app/billing/*`, `app/doctors/*`, `app/dashboard/legacy-app.tsx`, `app/dashboard/legacy-body.ts`, `app/settings/page.tsx`, `app/api/billing/route.ts`, `public/legacy-app.js`, `public/legacy.css`, `components/money-input.tsx`, `lib/money.ts`, `lib/billing-finance.ts`, `lib/billing-row.ts`, `lib/billing-reports.ts`, tipos/projeções de auditoria, testes financeiros e a migration incremental.

A migration foi aplicada em produção e verificada: hashes e contagens de estado clínico, atendimentos, registros financeiros, notas, despesas e logs permaneceram idênticos. A função continua `SECURITY INVOKER`, sem execução por `anon`/`authenticated`, e com execução restrita ao serviço do backend. O advisor manteve os 23 avisos informativos preexistentes de RLS sem políticas, coerentes com o acesso exclusivo pelo servidor; nenhum novo alerta.
