<div align="center">

<img src="docs/assets/rn-integra-logo.png" alt="RN Integra" width="160">

# RN Integra

**Agendas médicas para clínicas, com papéis, permissões e isolamento por organização.**

[![CI](https://github.com/rn-integra/agenda-rn/actions/workflows/stabilization-check.yml/badge.svg)](https://github.com/rn-integra/agenda-rn/actions/workflows/stabilization-check.yml)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs)
![Supabase](https://img.shields.io/badge/Supabase-Postgres_17-3FCF8E?logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-gru1-000000?logo=vercel)

[Produção](https://agenda-rn.vercel.app) · [Contexto do projeto](docs/CONTEXTO_RN_INTEGRA.md) · [Roteiro de incidentes](docs/runbook-incidentes.md)

</div>

---

## Sumário

- [O que é](#o-que-é)
- [Stack](#stack)
- [Como rodar](#como-rodar)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Estrutura](#estrutura)
- [Banco de dados](#banco-de-dados)
- [Fluxo de trabalho](#fluxo-de-trabalho)
- [Segurança](#segurança)
- [Documentação](#documentação)

## O que é

O RN Integra organiza as agendas cirúrgicas e de consultório de clínicas. Cada organização é isolada das demais. Os acessos dependem do papel de cada pessoa:

| Papel | O que faz |
|---|---|
| **Gerente** (`general_manager`) | Administra a organização, os usuários e todas as agendas; aprova solicitações. |
| **Secretária** (`secretary`) | Opera as agendas que a gerência liberou para ela: marca, confirma e cuida das guias. |
| **Médico / anestesista** (`doctor`) | Vê a própria agenda e as agendas a que tem acesso; pede marcações. |

**Principais telas:**
- **Hub** (`/hub`): resumo do dia de todas as agendas.
- **Agenda**: dia, semana e mês, com impressão em PDF.
- **Área da organização**: usuários, médicos e agendas.
- **Faturamento**: implementado, mas **pausado** por flags até ser retomado.

## Stack

| Camada | Tecnologia |
|---|---|
| Aplicação | Next.js 16 (App Router), React, Tailwind CSS 4, componentes shadcn/ui |
| Agenda | `public/legacy-app.js` + `public/legacy.css` (DOM direto, carregado pela página `/dashboard`) |
| Banco | Supabase Postgres 17, acessado **só pelo servidor** com a chave secreta |
| Autenticação | Própria: tabelas `users` e `sessions` e cookie `agenda_rn_session` (não usa Supabase Auth) |
| Hospedagem | Vercel, região `gru1` (São Paulo) |
| Monitor | `lib/monitor/` + GitHub Actions a cada 15 min |

## Como rodar

Pré-requisito: Node.js 22.13 ou superior.

```bash
npm ci
npm run dev            # http://localhost:3000
```

**Verificações, as mesmas da CI:**

```bash
npm test               # testes (node --test em tests/*.test.mjs)
npm run lint
npx tsc --noEmit
npm run build
npm run test:db        # funções de segurança num PostgreSQL em memória (PGlite)
```

Para ver só as falhas de um arquivo: `node --test --test-reporter=dot tests/<arquivo>.test.mjs`.

## Variáveis de ambiente

Os valores ficam na Vercel. **Nunca** os coloque no repositório.

| Variável | Para quê |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SECRET_KEY` | Chave secreta do Supabase, usada só no servidor |
| `CRON_SECRET` | Autoriza as rotas de cron e do monitor |
| `APP_ORIGIN` | Endereço oficial do app: base dos links nos e-mails e origem aceita nas mutações. Só em produção; o preview usa o próprio endereço |
| `RESEND_API_KEY`, `EMAIL_FROM` | Envio de e-mails (convites, confirmação, senha, agenda dos médicos). Hoje só no Preview, com o remetente de teste `onboarding@resend.dev`, que entrega apenas no e-mail da conta do Resend. Produção depois do domínio próprio |
| `PUBLIC_SIGNUP_ENABLED` | Libera o cadastro público de novas clínicas |
| `ALERT_WEBHOOK_URL`, `ALERT_EMAIL` | Destino dos alertas do monitor |
| `RN_PROFESSIONAL_BILLING_ENABLED`, `RN_DENIALS_ENABLED`, `RN_PORTAL_SUBMISSIONS_ENABLED`, `RN_MONTHLY_CLOSING_ENABLED` | Flags dos módulos de faturamento (pausados) |

Os previews da Vercel usam um **banco Supabase próprio**, separado do de produção.

## Estrutura

```
app/                  páginas e rotas de API (Next.js App Router)
components/           componentes React (ui/ = shadcn)
lib/                  regras de negócio, segurança, agenda, monitor
public/               agenda legada (legacy-app.js, legacy.css) e imagens
supabase/
  migrations/         histórico oficial do banco (AAAAMMDDHHMMSS_nome.sql)
  checks/             consultas de verificação, somente leitura
  validation/         checagens antes de liberar módulos
  *.sql               fontes antigas do faturamento, usadas pelos testes de banco
tests/                testes (vários são "contratos" por regex sobre o código)
backups/schema/       esqueleto atual do banco (só estrutura, sem dados)
docs/                 contexto, roteiro de incidentes, arquitetura e faturamento
```

## Banco de dados

- **Migrações** ficam em `supabase/migrations/`.
  - Cada uma é aplicada **primeiro no preview**, testada no deploy de preview e **só depois em produção**.
  - Toda tabela nova recebe RLS ligada e `revoke` para `anon` e `authenticated`.
  - Toda função usa `set search_path = ''` e é liberada só para `service_role`.
- **Esqueleto do banco:** [`backups/schema/rn-integra-schema.sql`](backups/schema/) é o dump da estrutura de produção (esquema `public`, sem dados).
  - **Sempre que o banco mudar, regenere:**
    ```bash
    npm run db:schema
    ```
  - O comando não precisa de Docker: lê a estrutura pela API oficial do Supabase, usando um token pessoal guardado no `.env.local`.
  - O passo a passo está em [`backups/schema/README.md`](backups/schema/README.md).

## Fluxo de trabalho

1. Crie uma branch a partir da `main`.
2. Rode testes, lint, `tsc` e build.
3. Faça push. A Vercel publica um preview, que usa o banco de preview.
4. Abra a PR, com a descrição em português, e espere a CI.
5. Faça o merge com **squash** e apague a branch.
6. Confira `/api/health` em produção: o campo `version` mostra o SHA curto do deploy.

A `main` é protegida: só recebe mudanças por PR com a CI verde (`test`, `lint`, `types_and_dependencies`) e não aceita push direto, force push nem exclusão.

## Segurança

- **Mutações:** toda rota de mutação passa por `secureMutation` (`lib/security/http.ts`), que confere a origem e padroniza os erros.
- **Sessões:** duram 8 horas, são revogadas quando a senha muda e o token tem formato rígido (`app/authz.ts`).
- **Tentativas:** os limites ficam no banco (`lib/security/rate-limit.ts`): por conta, por IP e global.
- **Permissões:** vêm do banco a cada requisição. A secretária só vê as agendas liberadas; o médico, só as dele e as compartilhadas.
- **LGPD:** há exportação e anonimização de pacientes. Os textos jurídicos ficam em `lib/legal.ts`.
- **Banco:** RLS ligado em todas as tabelas e nenhuma permissão para `anon`/`authenticated`: o navegador nunca fala com o banco. As funções têm `search_path` vazio e só o servidor (`service_role`) as executa, inclusive as criadas no futuro. A CI confere tudo isso restaurando o esqueleto do banco (`tests/schema-backup.test.mjs`).
- **Contas:** tudo pertence à empresa. O GitHub entra pela conta Google da empresa e exige 2FA de todos os membros; Vercel, Supabase e Resend entram pelo GitHub da empresa.
- **Chaves:** ficam na Vercel como *Secret* (nem o painel mostra o valor). A chave do Resend só tem permissão de envio.
- **Segredos:** nunca entram no repositório, em logs ou em mensagens.

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/CONTEXTO_RN_INTEGRA.md`](docs/CONTEXTO_RN_INTEGRA.md) | Histórico, decisões e estado atual |
| [`docs/runbook-incidentes.md`](docs/runbook-incidentes.md) | O que fazer quando o monitor alerta |
| [`docs/architecture/organization-isolation.md`](docs/architecture/organization-isolation.md) | Como as organizações ficam isoladas |
| [`docs/prontidao-lancamento-2026-11-06.md`](docs/prontidao-lancamento-2026-11-06.md) | Checklist e testes de carga para o lançamento |
| [`docs/faturamento/`](docs/faturamento/) | Desenho do módulo de faturamento (pausado) |

---

<div align="center"><sub>© RN Assessoria · RN Integra</sub></div>
