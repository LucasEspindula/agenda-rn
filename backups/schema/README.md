# Esqueleto do banco

[`rn-integra-schema.sql`](./rn-integra-schema.sql) é o dump da **estrutura** do banco de produção (esquema `public`). Ele contém:

- tabelas, colunas e valores padrão;
- chaves e restrições;
- índices;
- funções e gatilhos;
- RLS e permissões (GRANT/REVOKE).

**Não contém dados:** nenhum paciente, usuário, sessão, agenda ou valor financeiro.

## Quando atualizar

**Sempre que uma migração for aplicada em produção**, rode:

```bash
npm run db:schema
```

e faça o commit do arquivo junto com a migração (ou logo depois dela). O git guarda as versões anteriores, então não crie cópias com data no nome.

**Requisitos:**
- Docker Desktop aberto;
- login feito uma vez com `npx supabase login` (abre o navegador).

O comando usa o `supabase db dump` oficial: liga a CLI ao projeto de produção e grava só a estrutura.

Para comparar com o banco dos previews, rode `npm run db:schema -- preview`. O resultado vai para `.preview-schema.sql`, que fica fora do git.

## Como usar numa recuperação

1. Crie um **projeto Supabase novo e vazio**, com Postgres 17. O dump não recria os esquemas internos do Supabase (`auth`, `storage`…), que o projeto novo já traz.
2. Execute o arquivo no projeto novo, com o SQL Editor ou o `psql`.
3. Restaure os dados a partir do backup do Supabase (plano Pro), se houver.
4. Configure as variáveis da Vercel, o Storage e o monitor, e teste login, agenda e permissões antes de liberar.

**Nunca execute este arquivo no banco atual**: ele cria objetos que já existem e redefine permissões.

## O que não está aqui

- Os **dados**: dependem dos backups do próprio Supabase.
- Os **arquivos do Storage** (documentos e comprovantes).
- As **configurações do projeto** (chaves, variáveis e Auth).
