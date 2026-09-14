# Agenda RN

Aplicação Next.js em Vercel, com autenticação própria e Supabase acessado exclusivamente pelo servidor. A chave privilegiada nunca pertence ao navegador.

## Desenvolvimento e verificação

- `npm ci`
- `npm run build`
- `npm test` (após o build, para verificar também o CSS gerado)
- `npm run test:db` (PostgreSQL isolado, sem acesso a produção)
- `npm start`

Variáveis do servidor: `APP_ORIGIN` (origem canônica, em produção `https://agenda-rn.vercel.app`), `NEXT_PUBLIC_SUPABASE_URL` (HTTPS) e `SUPABASE_SECRET_KEY`. Não commitar valores reais. A aplicação não usa Supabase Auth: login, usuários e sessões pertencem às tabelas da aplicação.

## Atualização de segurança de 14/09/2026

Aplicar `supabase/migrations/20260914031343_security_hardening.sql` antes da implantação do código. A migração adiciona limites persistentes, revogação de sessões ao mudar credenciais e transações para agenda/auditoria. Não abre acesso público ao banco.

O login não cria contas nem aceita `INITIAL_MANAGER_PASSWORD`. Contas existentes com senha continuam funcionando; hashes antigos são atualizados após login correto. Uma instalação nova exige provisionamento administrativo fora da rota pública. Novas senhas devem ter de 12 a 128 caracteres. Sessões novas duram 8 horas.

Autorizações vêm do banco a cada requisição. Transferir registros e criar vínculos com agendas não concedidas exige gerência. O navegador guarda a agenda somente em memória; exportações e impressões continuam contendo dados sensíveis sob responsabilidade de quem as realiza. Uma aba já aberta só pode perder dados que ainda não recebeu: revogar permissão não desfaz uma leitura anterior.

Os limites de login são 10 tentativas por conta/15 minutos, 30 por IP/5 minutos na Vercel e 300 globais/minuto. A indisponibilidade do controle bloqueia login com 503. Monitorar esses limites e considerar MFA e proteção de borda contra ataques distribuídos.

O código legado de execução Cloudflare/Vinext/D1 foi removido da aplicação ativa porque a produção usa Next.js/Vercel/Supabase. O histórico Git mantém os arquivos anteriores. O teste de componentes passa a usar o compilador TypeScript, sem servidor Vite.

A auditoria detalhada está em `security/auditoria-2026-09-14.md`. Não confundir aprovação dos testes ou ausência de alertas em npm audit com garantia de segurança absoluta.
