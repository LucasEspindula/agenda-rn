# Prontidão para lançamento público (outras clínicas) — 06/11/2026

Decisão do dono do produto (06/11): lançar para **outras clínicas**. A Fase 2B (multiempresa) volta a valer. O banco de produção só tem dados de teste e será zerado antes do lançamento.

## Veredito

**Ainda não está pronto para receber outras clínicas.** A base de segurança de uma organização está boa. Os bloqueios são: multiempresa, capacidade, planos de infraestrutura e LGPD.

## 1. Segurança — o que já está bom (verificado no código)

- Sessão própria: token aleatório de 2 UUIDs; o banco guarda só o SHA-256; cookie `httpOnly`, `secure`, `SameSite=Strict`, 8 h.
- Senhas com PBKDF2-SHA256 600 000 iterações e comparação em tempo constante; o login gasta o mesmo tempo para conta inexistente.
- Rate limit no login: global 300/min, por conta 10/15 min, por IP 30/5 min.
- Toda mutação confere `Origin` e `Sec-Fetch-Site`; o corpo JSON tem tamanho máximo.
- CSP com nonce e `strict-dynamic`, `frame-ancestors 'none'`, HSTS, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`.
- Banco: RLS ligado em todas as 50 tabelas, sem políticas (nega tudo para `anon` e `authenticated`). Só o servidor (service role) acessa. O Supabase não aponta alerta de segurança além desse aviso informativo.
- Firewall da Vercel: no teste de sobrecarga, passou a responder 403 e depois bloqueou o IP gerador (~1 000 req/s). Isso é proteção contra DDoS.

## 2. Bloqueios para outras clínicas

### 2.1 Multiempresa (Fase 2B) — bloqueio de propósito
- `rn_agenda_organization_id()` e `rn_finance_single_organization_id()` exigem `slug='rn-gestao'` e **exatamente 1 organização**. `app/authz.ts` faz o mesmo (`organizations.count===1`). Criar uma segunda clínica hoje **derruba o acesso de todos**, por desenho fail-closed.
- 16 tabelas não têm `organization_id`: `users`, `sessions`, `agenda_access`, `agenda_requests`, `audit_logs`, `notifications`, `doctor_agendas`, `surgery_documents`, `directory_audit`, `billing_audit`, `billing_commercial_modalities`, `billing_counterparties`, `billing_professional_commercial_rules`, `billing_submission_channels`, `security_rate_limits`, `organizations`.
- `users.role` é global (um papel por pessoa). No multiempresa, o papel tem de ficar no vínculo (`organization_memberships`).
- `/api/access`, `/api/financial-attachments` e o polling de revisão leem `audit_logs` e `notifications` sem filtro de organização.
- Não existe cadastro de clínica: criar organização, primeiro gerente, convite de usuários, recuperação de senha.

### 2.2 Capacidade (teste de carga em produção, 06/11)
| Cenário | Resultado |
| --- | --- |
| 1 usuário, produção (`iad1`) | `/api/state/revision` p50 1,15 s; `/api/state` 0,94 s |
| 1 usuário, preview em `gru1` | `/api/state/revision` p50 **0,30 s** |
| 10/25/50 conexões, `/api/state/revision` | trava em **~7 req/s**; p95 3 s → 5 s → 12 s |
| 25 conexões, `/api/state` | ~11 req/s, p95 3,1 s |

- Causa 1: as funções da Vercel rodavam em Washington (`iad1`) e o banco está em São Paulo. Cada requisição faz de 5 a 9 idas ao banco. **Corrigido nesta branch** (`vercel.json` → `regions: ["gru1"]`).
- Causa 2: cada aba aberta consulta `/api/state/revision` **a cada 3 s**. Cada consulta faz cerca de 9 chamadas ao banco: sessão, vínculo, contagem de organizações, acessos, revisão, auditoria, 2× notificações e pedidos. Com o teto medido (~7 req/s), isso dá uns **20 usuários simultâneos**.
- Causa 3: Supabase **Free** (Nano, CPU compartilhada, pool do PostgREST com 10 conexões, máximo de 60 conexões).
- `/api/state` devolve a agenda inteira da organização. Ela cresce sem limite com o histórico e precisa de janela por período.

### 2.2.1 Resultado da fase 1 (mesmo dia, preview `gru1` + migration `20261106190000_session_sync_single_call`)
| Cenário | Antes (`iad1`, ~9 consultas) | Depois (`gru1`, 1 RPC) |
| --- | --- | --- |
| `/api/state/revision`, 1 conexão | p50 1 154 ms | p50 **130 ms** |
| `/api/state/revision`, 10 conexões | 4,4 req/s, p95 3 076 ms | **48 req/s**, p95 287 ms |
| `/api/state/revision`, 25 conexões | 6,9 req/s, p95 4 973 ms | **48 req/s**, p95 865 ms |
| `/api/session`, 10 conexões | — | 51 req/s, p95 270 ms |
| `/api/state`, 10 conexões | — | 21 req/s, p95 635 ms |

O polling agora vai de 4 s (com atividade) até 15 s (sem mudanças). Com o teto medido (~48 req/s, Supabase Free), a estimativa é de algumas centenas de abas abertas, contra ~20 antes. O próximo limite é o plano do Supabase e o `/api/state`, que devolve a agenda inteira.

### 2.3 Infraestrutura e contrato
- Vercel **Hobby** não permite uso comercial. Lançar para clínicas pagantes exige **Vercel Pro**.
- Supabase **Free**: sem backup diário restaurável, pausa por inatividade e CPU compartilhada. Para dado de saúde em produção, o mínimo é **Pro** com backups e, idealmente, PITR.
- Previews usam o mesmo banco da produção. Antes do lançamento, os previews precisam de um banco próprio.

### 2.4 LGPD (dado de saúde é dado sensível)
- Não há política de privacidade, termos de uso, contrato de operador (a clínica é a controladora, o RN Integra é o operador), registro de incidentes, nem exportação/eliminação de dados por titular.
- Faltam: retenção e limpeza de sessões expiradas (hoje acumulam) e de logs, e trilha de quem acessou o prontuário.

## 3. Plano proposto (em ordem)

1. **Capacidade imediata (sem decisão de custo):** `gru1` (feito na branch); sessão + revisão numa única RPC (1 ida ao banco); polling adaptativo (5 s visível, para quando oculto, recua quando não há mudanças); `/api/state` por período. Repetir o teste de carga de um ponto fora da minha rede, porque o firewall bloqueia um único IP.
2. **Planos pagos:** Vercel Pro + Supabase Pro (dimensionar o compute após o passo 1) e banco separado para previews.
3. **Multiempresa (2B retomada):** organização derivada da sessão em todas as RPCs; `organization_id` nas 16 tabelas; papel no vínculo; testes cross-tenant com duas clínicas; só então remover o guard de organização única.
4. **Onboarding:** cadastro de clínica, convite, troca e recuperação de senha, 2FA opcional para gerente.
5. **LGPD e operação:** termos, privacidade, DPA, exportação/eliminação, retenção, monitoramento de erros e alertas, runbook de incidente, teste de restauração de backup.
6. **UX:** revisão por papel (gerente, secretária, médico, anestesista) em desktop e mobile, com estados vazios, erros e onboarding guiado.
7. **Lançamento:** zerar o banco (com confirmação), criar a primeira clínica real, monitorar.
