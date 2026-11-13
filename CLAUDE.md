# RN Integra — guia para o assistente

Memória persistente do projeto. Leia antes de qualquer tarefa. O histórico detalhado de etapas, decisões e pendências fica em [`docs/CONTEXTO_RN_INTEGRA.md`](docs/CONTEXTO_RN_INTEGRA.md); atualize os dois ao concluir algo relevante.

## O que é

Sistema de agendas médicas multiorganização (clínicas). Papéis: `general_manager` (gerente), `secretary` (secretária), `doctor` (médico/anestesista). Foco atual: **agenda primeiro**. O **faturamento está pausado**: não mexer sem pedido explícito.

- **Stack:** Next.js 16 (App Router) na Vercel, região `gru1`, plano Hobby. Supabase Postgres, projeto `nagddicinjszfrtwgjbu`.
- **Contas (desde 13/11/2026):** tudo pertence à empresa RN Assessoria. GitHub na organização `rn-integra`; Supabase na organização "RN Integra" (`xtnswwghfqggqesrkqnx`), com produção e preview; Vercel no time "RN Integra" (`team_ZzwM8ykcrLvRvCvL7BXvMgRB`), projeto `prj_XiOYwxCOguNmorHg30FRF3M9lER5`. O time da Vercel ainda está no Hobby: o repositório precisa continuar público até o Pro.
- **Repositório:** `rn-integra/agenda-rn` (público, então nunca commitar segredos). Branch principal `main`, e cada PR é mergeada com squash.
- **Agenda legada:** `public/legacy-app.js` e `public/legacy.css` manipulam o DOM diretamente. O `<select id="professionalFilter">` continua sendo a fonte da verdade das agendas visíveis por papel.
- **Navegação do celular:** `components/mobile-navigation.tsx`, com gaveta lateral e gesto em `components/menu-swipe.ts`.
- **Segurança:**
  - rotas de mutação usam `secureMutation` (`lib/security/http.ts`), que confere a origem e trata os erros;
  - sessão em `app/authz.ts` (`getSession`);
  - limites de tentativa em `lib/security/rate-limit.ts`.
- **Monitoramento:** `lib/monitor/`, com roteiro em [`docs/runbook-incidentes.md`](docs/runbook-incidentes.md).
  - **Camadas:** corrige sozinho (`repair`), depois diagnostica (`playbook.ts`), e só então chama um dev.
  - **Novos erros:** cada erro novo resolvido vira entrada no playbook.
- **Assistente da agenda:** card "Resumo do dia" no topo da agenda (`GET /api/agenda/summary`, regras em `lib/agenda/assistant.ts`, sobre a agenda já filtrada por `visibleState`).
  - gerência e secretária: lembretes de confirmação, guias, conflitos de horário e sugestões paradas (secretária só nas agendas liberadas);
  - médico: **sem pendências**, só a agenda de hoje dele e das agendas a que tem acesso;
  - sem CPF nem dados financeiros.
- **Textos jurídicos:** `lib/legal.ts`, com dados do fornecedor ainda por preencher e o prazo de 48 h para avisar a clínica em caso de incidente.

## Como trabalhar aqui

- O usuário escreve em **português**. Responda em português, de forma objetiva.
- **Fluxo padrão de uma mudança:**
  1. Criar uma branch.
  2. Rodar os testes, o lint, o `npx tsc --noEmit` e o `npm run build`.
  3. Fazer push.
  4. Testar no preview da Vercel.
  5. Abrir a PR.
  6. Esperar a CI.
  7. **Perguntar antes do merge** (“Faço o merge com squash?”).
  8. Depois do merge, conferir `/api/health` em produção (o campo `version` traz o SHA curto), atualizar o `main` local e apagar a branch.
- **Testes:** `npm test`, que roda `node --test` sobre `tests/*.test.mjs`.
  - Para ver só as falhas: `node --test --test-reporter=dot tests/<arquivo>`.
  - `tests/load-ts.mjs` carrega TypeScript com mocks de módulos.
  - Muitos testes são “contratos” por regex sobre o código-fonte: ao mudar um trecho coberto, atualize o teste.
- **Fins de linha:** vários arquivos usam CRLF (por exemplo `lib/security/http.ts` e algumas migrações). Edite preservando o fim de linha; nos regex de teste, use `\r?\n`.
- **Migrações:** ficam em `supabase/migrations/AAAAMMDDHHMMSS_nome.sql`. **Sempre pedir confirmação antes de aplicar no banco real.** Cada migração vai para **os dois projetos**, com confirmação para cada um, nesta ordem: **primeiro o preview**, testar no preview da Vercel, **depois produção**. Toda tabela nova recebe RLS ligada e `revoke` de `anon` e `authenticated`; as funções usam `set search_path=''` e são liberadas só para `service_role`. **Depois de aplicar em produção, rodar `npm run db:schema`** (precisa do Docker Desktop aberto e de `npx supabase login`) e commitar `backups/schema/rn-integra-schema.sql`: é o esqueleto do banco para recuperação.
- **Banco de produção:** hoje só tem dados de teste, e o usuário autorizou testar nele. Antes do lançamento ele será zerado, sempre com confirmação.
- **Banco dos previews:** desde 11/11/2026 os previews da Vercel usam um Supabase próprio, `funqdoiubwskmhefbvjz` ("Agenda RN Preview", São Paulo), com o mesmo schema de produção. Dados de exemplo: organização "Clínica Preview" (`00000000-0000-4000-8000-0000000000a1`) e usuários 7 (gerente), 8 (secretária), 9 (médico) e 10 (anestesista), todos `@preview.test` e sem senha.
- **Testar o preview logado:** criar uma sessão temporária em `public.sessions` **do banco de preview** (usuários 7–10, `organization_id` da Clínica Preview), gravando apenas `token_hash = encode(sha256(convert_to(token,'UTF8')),'base64')`. O token precisa ter **73 caracteres: dois UUIDs unidos por `-`**; qualquer outro formato é recusado (`app/authz.ts`). Pôr o token no cookie `agenda_rn_session` do link de preview (obtido com `get_access_to_vercel_url`) e **apagar a sessão no fim**. Nunca pedir nem usar senhas.
- **PRs e merges:** sem a CLI `gh`. Usar o navegador ou a API pública. Corpo da PR em português.
- **Ações destrutivas** (apagar dados, zerar banco, Storage) pedem confirmação explícita.
- **Nunca** colocar senhas, chaves ou dados de pacientes no chat, no repositório ou em logs.

## Pendências conhecidas (detalhes em `docs/CONTEXTO_RN_INTEGRA.md`)

- **Lado do responsável:**
  - preencher os dados jurídicos em `lib/legal.ts` e passar pela revisão de um advogado;
  - domínio e Resend (`RESEND_API_KEY`, `EMAIL_FROM`, `APP_ORIGIN`, depois `PUBLIC_SIGNUP_ENABLED`);
  - planos Vercel Pro e Supabase Pro;
  - configurar o monitor (`MONITOR_URL` e `CRON_SECRET` no GitHub; `ALERT_WEBHOOK_URL` ou `ALERT_EMAIL` na Vercel);
  - zerar banco e Storage antes de abrir.
- **Técnico:**
  - teste de restauração de backup;
  - e-mail da agenda para médicos e anestesistas (depende do Resend): agenda de amanhã às 20h do dia anterior e prévia da semana seguinte às 20h de sexta; secretárias e gerência não recebem;
  - depois: faturamento M2c e remoção de `app_state` (A2).
