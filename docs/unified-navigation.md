# Navegação e cadastro central — RN Integra

Base: `631b556d4ff9818ec1087d22506e2f9c2287c173`.

## Alteração

- `components/site-header.tsx` e `lib/navigation.ts`: menu global por permissões, módulo ativo e acesso direto entre Agendamento, Faturamento e Médicos; configurações somente para a gerência.
- `app/doctors/doctor-directory.tsx` e `app/api/doctors/route.ts`: dados profissionais, serviços, configuração de agenda e login centralizados. Permissões adicionais de agenda são preservadas; editar apenas o médico não recria o acesso.
- `app/settings/page.tsx`: hospitais, regras e acessos administrativos. Contas médicas apontam para o cadastro central.
- `app/dashboard/*`, `public/legacy-app.js` e `public/legacy.css`: navegação operacional abaixo do menu global. Pacientes, solicitações, notificações, histórico, cancelados, bloqueios e aprovação de sugestões permanecem. Removidos cadastro paralelo e relatório mensal legado.
- `app/billing/billing-client.tsx`: removido CRUD duplicado de médicos; vínculos e entidades financeiras permanecem no Faturamento.

## Migração incremental

`20260922210707_unified_navigation_doctor_agendas.sql` substitui somente `save_doctor_directory`, mantendo `SECURITY INVOKER`, acesso exclusivo via service role, autorização de gerente e auditoria transacional. A operação existente `save_doctor_with_access` engloba médico, agenda e eventual login na mesma transação.

Novo médico com Agendamento recebe agenda ativa 07:00–19:00. OFF → ON cria ou reativa a mesma agenda; ON → OFF preserva configuração e histórico. Horários existentes e agendas explicitamente pausadas não são sobrescritos em edições comuns. A migração preenche apenas agendas ausentes e atualiza a projeção canônica.

Não altera tabelas, regras, relatórios nem históricos financeiros. Não renomeia chaves técnicas históricas. O runtime operacional da Agenda permanece deliberadamente, com navegação por documento entre módulos para preservar seu ciclo de vida.

## Verificação

- `npm test`: 115 testes aprovados, incluindo transições de agenda em PostgreSQL/PGlite, rollback de login inválido, preservação de configurações e rejeição de perfis não autorizados.
- `npm run build`: aprovado, incluindo o proxy/CSP original da aplicação.
- `npm run lint`: zero erros, 26 avisos. 25 avisos já existiam; um aviso de stylesheet manual foi acrescentado em Configurações, seguindo a integração CSS isolada da Agenda. Um aviso antigo de variável não utilizada foi removido. Navegação por documento no runtime legado é intencional.
- Navegador com Next em produção, HTTPS e banco PGlite executando as funções SQL reais: gerente cadastra médico, encontra agenda automática, cadastra paciente, cria atendimento e edita procedimento; convênio preservado separadamente da forma de cobrança.
- Desktop e mobile: Agenda, Pacientes, Solicitações, Histórico, Cancelados, Configurações, Faturamento e Médicos; navegação direta entre módulos. Médico com Agenda e médico com Agenda + NF conservam navegação permitida; APIs administrativas permanecem bloqueadas.
- Testes de navegador usam contas e dados sintéticos isolados; nenhuma mutação de teste é feita em produção.

As verificações de segurança mantêm o modelo atual de RLS sem políticas públicas, com consultas autorizadas no servidor. O aviso informativo do Supabase sobre ausência de políticas é esperado nesse modelo: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
