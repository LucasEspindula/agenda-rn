# Roteiro de resposta a incidentes — RN Integra

> Para quem recebe um alerta do monitor. Escrito para ser seguido **sem precisar programar** até o ponto em que um dev é realmente necessário.
> Compromisso escrito nos textos jurídicos: avisar a clínica contratante em até **48 horas** após tomar conhecimento de um incidente de segurança que envolva dados dela (`lib/legal.ts → LEGAL_TERMS.incidentNoticeHours`).

## 1. Como o monitor funciona

O monitor é o começo do assistente da agenda. Ele trabalha em três camadas e só chama alguém quando as anteriores não bastam:

| Camada | O que faz | Exemplos |
| --- | --- | --- |
| **1. Corrige sozinho** | Ações seguras e repetíveis, conferidas logo depois | Roda a manutenção atrasada; recarrega o navegador preso numa versão antiga; dá outra chance a falhas passageiras de rede e as encerra quando param |
| **2. Diagnostica** | Reconhece erros já catalogados e manda junto **o que é** e **o que fazer** | Falta de configuração de e-mail, chave do banco ausente, banco sobrecarregado |
| **3. Chama um dev** | Erro novo, sem solução catalogada, ou conserto automático que falhou | O alerta diz “Precisa de um dev” |

**De onde vêm os incidentes**

- **Servidor:** qualquer falha inesperada numa rota (`secureMutation` e `instrumentation.ts`).
- **Navegador:** erros de JavaScript do próprio sistema (`components/client-monitor.tsx`), no máximo 5 por página.
- **Verificações:** a cada 15 minutos (GitHub Actions `monitor.yml`) e 1 vez por dia (Vercel Cron, reserva). Conferem banco, manutenção diária, tentativas de login, e-mail e canais de aviso (`lib/monitor/checks.ts`).

Erros iguais viram **um** incidente, com contador de ocorrências. Nada de dado pessoal é gravado: e-mails, CPFs, telefones, ids e tokens são removidos antes (`lib/monitor/scrub.ts`).

**Quando avisa**

| Gravidade | Repete o aviso no máximo | Observação |
| --- | --- | --- |
| Crítico | 1 vez por hora | Também faz o job do GitHub falhar, e o GitHub manda e-mail |
| Erro | 1 vez a cada 6 h | |
| Atenção | 1 vez por dia | Falhas passageiras só avisam a partir da 5ª ocorrência |
| Info | nunca | Fica só no registro, por exemplo “corrigido automaticamente” |

Quando um problema que gerou aviso volta ao normal, chega um aviso **“✅ Resolvido”**. Previews e ambiente local gravam incidentes, mas nunca avisam.

## 2. Configuração (uma vez)

| Onde | Nome | Valor |
| --- | --- | --- |
| Vercel (produção) | `CRON_SECRET` | já existe |
| Vercel (produção) | `ALERT_WEBHOOK_URL` | opcional: webhook de um canal do Discord ou Slack (https) |
| Vercel (produção) | `ALERT_EMAIL` | opcional: e-mail de quem responde; depende do Resend configurado |
| GitHub → Settings → Secrets and variables → Actions → *Secrets* | `CRON_SECRET` | o mesmo valor da Vercel |
| GitHub → Settings → Secrets and variables → Actions → *Variables* | `MONITOR_URL` | endereço de produção, sem `/` no final |

Para testar: GitHub → Actions → **Monitor RN Integra** → *Run workflow*. O resumo mostra `ok`, as contagens e quantos problemas foram corrigidos sozinhos.

O repositório é público, então os logs do GitHub mostram **só contagens**. Os detalhes ficam no alerta e no banco.

## 3. Recebi um alerta: o que fazer

1. **Leia “Diagnóstico” e “O que fazer”.** Se houver uma ação objetiva (configurar variável, ver painel), faça e aguarde o próximo ciclo de 15 minutos. O “✅ Resolvido” confirma.
2. **Avalie se é incidente de segurança com dados.** É, se houver qualquer sinal de acesso indevido, vazamento, perda ou alteração de dados de uma clínica: alguém vendo agenda de outra organização, dados apagados sem ação do usuário, chave exposta, muitas falhas de login seguidas de um login bem-sucedido estranho.
   - **Se sim**, siga a seção 4: o prazo de 48 h começa agora.
3. **Sistema fora do ar** (“Banco de dados não responde” ou job do GitHub falhando no `/api/health`):
   1. Veja status.supabase.com e vercel-status.com.
   2. No Supabase, confira se o projeto não está pausado nem acima do limite do plano.
   3. Na Vercel, confira se o último deploy está “Ready”. Se o problema começou num deploy, use **Instant Rollback** para o anterior.
4. **“Precisa de um dev”:** passe ao dev o título do alerta, o horário e a rota. O dev encontra os detalhes na tabela `monitor_incidents` (seção 5) e no log da Vercel.
5. **Depois de resolver um erro novo:** o dev cadastra o padrão em `lib/monitor/playbook.ts` com diagnóstico e ação. Assim, da próxima vez, o monitor já explica o erro sozinho.

## 4. Incidente de segurança com dados (LGPD)

| Prazo | Ação |
| --- | --- |
| Imediato | **Conter:** trocar chaves expostas (Supabase `SUPABASE_SECRET_KEY`, `CRON_SECRET`); encerrar sessões (`delete from public.sessions where user_id = …`); desativar a conta envolvida; rollback do deploy se a falha veio de uma publicação |
| Até 24 h | **Entender:** quais organizações e titulares, quais dados, desde quando. Fontes: `security_events`, `audit_logs`, `monitor_incidents` e logs da Vercel. Registrar tudo num documento com horários |
| **Até 48 h** | **Avisar cada clínica afetada** (Controladora), por escrito, com: natureza do incidente, dados e titulares afetados, medidas adotadas e recomendadas, e contato para acompanhamento. Modelo abaixo |
| Em seguida | Apoiar a clínica na comunicação à ANPD e aos titulares (responsabilidade dela como Controladora); corrigir a causa; cadastrar o padrão no playbook |

**Modelo de aviso à clínica**

> Assunto: Comunicação de incidente de segurança — RN Integra
>
> Em [data/hora] identificamos [descrição objetiva]. Dados possivelmente afetados: [categorias]. Titulares: [quantidade/quem]. Período: [de–até].
> Medidas já adotadas: [contenção]. Recomendamos: [ex.: orientar usuários a trocar a senha].
> Seguimos investigando e enviaremos atualização até [data]. Contato: [encarregado/DPO — `lib/legal.ts`].

## 5. Consultas úteis (Supabase → SQL Editor)

```sql
-- Incidentes abertos, mais recentes primeiro
select severity, source, title, route, occurrences, playbook, auto_fix, first_seen, last_seen
from public.monitor_incidents where resolved_at is null order by last_seen desc;

-- O que o monitor corrigiu sozinho nos últimos 7 dias
select title, detail, first_seen from public.monitor_incidents
where auto_fix = 'repaired' and first_seen > now() - interval '7 days' order by first_seen desc;

-- Rotinas: última execução da manutenção e do monitor
select * from public.monitor_heartbeats;

-- Encerrar manualmente um incidente já tratado
update public.monitor_incidents set resolved_at = now() where id = <id>;
```

## 6. Como ensinar algo novo ao assistente

- **Erro conhecido:** adicionar um item em `lib/monitor/playbook.ts` com `match`, `diagnosis`, `action` e `auto`.
- **Nova verificação:** adicionar um item em `CHECKS` (`lib/monitor/checks.ts`) com `run()`. Se houver um conserto **seguro, repetível e que não toca em dado de paciente**, acrescentar `repair()`. O executor tenta o conserto, verifica de novo e só avisa se o problema continuar.
- **Próximos passos planejados:**
  - lembretes da agenda (consultas de amanhã sem confirmação, conflitos de horário);
  - resumo diário para o gerente;
  - painel de incidentes para o operador;
  - diagnóstico de erros novos com IA, sem enviar dados pessoais.
