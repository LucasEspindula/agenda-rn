# RN Integra — cópia de segurança da estrutura do Supabase

Data da captura: **28/10/2026**  
Projeto: **Agenda RN**  
Banco: **PostgreSQL 17 (Supabase)**  
Escopo: **apenas o esquema de aplicação `public`**

Arquivo: [`rn-integra-public-schema-2026-10-28.sql`](./rn-integra-public-schema-2026-10-28.sql)

## O que foi registrado

Extração de metadados do catálogo PostgreSQL, sem consultar as linhas das tabelas:

| Objeto | Quantidade |
| --- | ---: |
| Tabelas | 46 |
| Colunas | 531 |
| Funções | 71 |
| Gatilhos (incluindo 6 de restrição) | 52 |
| Restrições (PK, FK, UNIQUE e CHECK) | 296 |
| Índices adicionais | 61 |
| Sequências de identidade | 7 |
| Políticas RLS | 0 (46 tabelas com RLS habilitado) |

Foram incluídas as expressões padrão das colunas, os comentários, as extensões de aplicação e os GRANTs de objetos da aplicação.

## Limitações e cuidados

- **Não é uma cópia de dados.** Não inclui pacientes, médicos cadastrados, contas de usuário, hashes de senhas, sessões, atendimentos, faturamentos, notas, comprovantes, o JSON de `app_state` nem dados de tabelas.
- **Não inclui arquivos do Supabase Storage**, buckets e políticas do Storage; nem configurações do projeto (Auth, Edge Functions, secrets e variáveis de ambiente).
- **Não substitui um dump nativo do PostgreSQL.** Foi reconstruído consultando o catálogo e ainda não foi validado por uma restauração completa em banco isolado.
- **Não recria a infraestrutura interna do Supabase** (`auth`, `storage`, `vault`, papéis de serviço e demais esquemas gerenciados). É destinado a um projeto Supabase novo, com essa infraestrutura já disponível.
- **Não execute no banco atual.** O arquivo contém `CREATE TABLE`, `CREATE FUNCTION`, `REVOKE` e `GRANT` para um destino vazio. Pode falhar ou alterar permissões em um banco existente.
- A restauração não gera usuários ou o registro inicial de `app_state`; após a reconstrução estrutural, será necessário executar o fluxo de inicialização da aplicação, com as migrações compatíveis e as configurações apropriadas.
- O arquivo é um **marco estrutural**, não uma migração incremental do Supabase. Não coloque em `supabase/migrations` como se fosse uma migração pronta para o banco atual.

## Como usar quando for necessário

1. Crie um **novo projeto Supabase isolado** compatível com PostgreSQL 17.
2. Confirme que as extensões e os esquemas internos necessários do Supabase estão disponíveis.
3. Revise o arquivo SQL e execute-o somente no novo projeto (por um usuário administrativo).
4. Compare os objetos reconstruídos com a tabela de contagem acima.
5. Configure os secrets, Storage, políticas operacionais e inicialização do RN Integra separadamente.
6. Teste as operações da agenda, usuários e faturamento antes de considerar a recuperação utilizável.

## Alternativa oficial gratuita (recomendada para snapshots futuros)

A própria documentação do Supabase recomenda exportação com o CLI `supabase db dump` para projetos do plano gratuito. Um dump nativo do esquema feito com acesso de conexão apropriado é preferível a esta reconstrução por catálogo.

Consulte a documentação: https://supabase.com/docs/guides/platform/backups

## Segurança

Este arquivo não contém registros de usuários nem valores financeiros. Ele contém nomes de tabelas e código de funções de aplicação. Mantenha-o em repositório **privado**.
