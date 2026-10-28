# Reconciliação do histórico de migrations — 28/10/2026

> Diagnóstico de catálogo em modo somente leitura. Não executar `supabase db push` ou reparos históricos automaticamente até fechar as divergências abaixo.

## Inventário

- Antes da fundação: **58** arquivos SQL em `supabase/migrations/` no GitHub e **55** entradas registradas em `supabase_migrations.schema_migrations` no Supabase.
- A fundação foi aplicada usando ferramenta de migrations, com resultado confirmado: **`20261028203004:organization_foundation`**.
- A migration de fundação no GitHub foi renomeada para o mesmo número registrado pelo Supabase. O SQL é preservado integralmente.
- O app continua com `app_state(id=1)` e **não** oferece isolamento multiempresa operacional.

## Divergências anteriores, que permanecem pendentes

Os dois arquivos experimentais de migrations nunca aplicados foram retirados durante a desativação do antigo módulo documental. Os registros históricos de migrations já aplicadas foram preservados para reconciliação e recuperação do banco.

| Arquivo/registro | Verificação | Próximo tratamento |
| --- | --- | --- |
| `20261019235000_cash_paid_nonrealized_and_invoice_request_idempotence.sql` | GitHub; há entrada remota com nome semelhante `20261019185720:cash_paid_nonrealized_invoice_request_idempotence`. | Comparar definições e efeitos antes de marcar equivalente; nomes sozinhos não bastam. |
| `20261028123000_agenda_update_before_insert_trigger.sql` | Arquivo GitHub; ausência no histórico remoto. Corpo atual de `commit_agenda_change` no banco é **idêntico** ao SQL desse arquivo (comparação sem diferenças de espaçamento). | Reconciliar metadados da migration com ferramenta apropriada sem reaplicar função. |
| `20261019184531:archived_agenda_cancellations_uuid_repair` | Consta no histórico remoto, mas não há arquivo correspondente no GitHub. | Recuperar a definição histórica antes de declarar os ambientes sincronizados. |

Observação: várias migrations mais antigas possuem versões numéricas diferentes entre nome do arquivo GitHub e versão remota, apesar de nomes correspondentes. A reconciliação completa requer o mapeamento por versão, nome e conteúdo; **não** se deve simplesmente reexecutar arquivos.

## Verificações de segurança da fundação

- `organizations`: 1 registro (`rn-gestao`), tipo `MANAGEMENT_COMPANY`.
- `organization_memberships`: 4 vínculos ativos; os papéis correspondem aos quatro usuários existentes.
- RLS ativa nas 2 tabelas; nenhuma política pública; leitura negada para os papéis `anon` e `authenticated`; permitida à credencial de backend.
- `app_state` segue com 1 registro, sem transferência de dados clínicos/financeiros.

## Sequência de trabalho segura

1. Resolver arquivos ausentes/pendentes do histórico em ambiente de teste, sem `db push` cego.
2. Criar associação transacional entre usuário e organização no fluxo de cadastro.
3. Introduzir organização ativa e papel por organização em cada sessão, falhando fechado se o vínculo estiver ausente/inativo.
4. Só então migrar `app_state`, RPCs e tabelas de negócio para `organization_id`, testar duas organizações e liberar o onboarding.

O backup estrutural anterior foi gerado antes da fundação: uma restauração deverá incluir também a migration de organizações.
