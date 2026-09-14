# Agenda RN — Auditoria de segurança e plano de implantação

**Data:** 14 de setembro de 2026. **Repositório:** `LucasEspindula/agenda-rn`. **Base examinada:** `main`, commit `9f1ecc178ed0b8acc17a0158977345aed21f65b2`. **Produção informada:** `https://agenda-rn.vercel.app`. **Banco identificado:** Supabase Agenda RN, referência `nagddicinjszfrtwgjbu`.

## Atualização após aprovação — 14/09/2026

A migração foi aplicada ao Supabase Agenda RN (`nagddicinjszfrtwgjbu`) com sucesso e registrada como `20260914115046_security_hardening`. O arquivo SQL foi alinhado à versão registrada pelo serviço para evitar reaplicação indevida.

Verificação no banco real: RLS ativo no contador; ausência de permissões de tabela e execução para `anon` e `authenticated`; três funções `SECURITY INVOKER` com `search_path` fixo e execução por `service_role`; gatilho `users_revoke_sessions` ativo. Uma prova de limite em transação desfeita por rollback confirmou a recusa da segunda tentativa com limite 1. Nenhum registro clínico ou credencial foi alterado pelo teste.

O advisor apresenta somente nove avisos informativos de RLS sem políticas, coerentes com o acesso exclusivo pelo backend, conforme [explicação oficial](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). O código da aplicação permanece no PR nº 1, sem integração/implantação confirmada. A disponibilidade das funções no banco não ativa os limites nos endpoints antigos.

As referências abaixo à migração bloqueada descrevem a situação anterior à aprovação; esta atualização substitui esse status. Permanecem válidos os demais limites e riscos do relatório.

## 1. Parecer executivo

Foram encontradas falhas relevantes de autorização, armazenamento no navegador, autenticação e consistência transacional, além de dependências com alertas conhecidos. As correções estão preparadas no código e acompanhadas de testes. **Este documento não certifica segurança absoluta nem ausência de vulnerabilidades desconhecidas.**

**Estado da implantação:** as correções de aplicação ainda não estão confirmadas em produção. A migração SQL não foi aplicada: a revisão automática exigiu aprovação explícita para a mudança persistente. Não se deve implantar o novo código antes de instalar e verificar as funções SQL das quais ele depende. Indisponibilidade dessas funções bloqueia o login por projeto, sem liberar acesso como alternativa.

A aplicação utiliza autenticação própria, com usuários e sessões em tabelas do Supabase. **Ela não usa Supabase Auth como mecanismo de login.** Ativar MFA apenas no painel do provedor não adicionaria MFA aos usuários desta aplicação.

## 2. Escopo, evidências e limites

Foram obtidos os 132 arquivos textuais da revisão-base, incluindo código de aplicação, componentes, JavaScript público, configurações, testes, SQL e lockfile. As duas imagens binárias não foram analisadas como código. A análise combinou inventário e buscas de padrões perigosos com revisão manual dos fluxos sensíveis: login/logout, sessão, administração de acessos, estado da agenda, solicitações, documentos e atualização em tempo real.

Foram consultados o banco real somente para metadados de segurança e contagens de contas sem credenciais, os avisos oficiais dos fornecedores e o serviço de auditoria do npm. Testes de abuso foram executados sobre dados sintéticos e banco isolado. Não houve força bruta, carga agressiva, extração de prontuários ou exploração contra produção.

Cobertura direta: oito rotas de API; validação de sessão; três papéis; importação/estado global; renderização HTML; arquivos PDF; dependências de execução e desenvolvimento; permissões públicas do banco e bucket. O histórico completo de commits não foi submetido a uma varredura de segredos. A inspeção do estado atual não comprova que um segredo nunca existiu em versões anteriores.

Não foi possível comprovar configurações de WAF, proteção dos previews, backups/PITR, MFA administrativo, retenção e acesso aos logs ou segredos na Vercel. A conexão disponível não retornou equipes acessíveis. Esses controles não devem ser considerados verificados.

## 3. Achados e correções

As classificações abaixo consideram impacto e pré-condições. Um alerta de dependência não comprova que a exploração seja alcançável nesta instalação.

| ID | Gravidade | Achado na revisão-base | Correção preparada e verificação |
|---|---|---|---|
| SEC-01 | Crítica por dependência; exploração não demonstrada | Next.js 16.2.6 e Sharp 0.34.5 entram em faixas de avisos de segurança, incluindo processamento de imagens AVIF/HEIF. | Next.js e eslint-config-next 16.3.5; Sharp 0.35.4; otimização de imagens desativada porque não é necessária nesta interface. Build e auditoria npm verificados. |
| SEC-02 | Alta | `PUT /api/state` filtrava agendamentos pelo vínculo proposto pelo cliente sem confrontá-lo integralmente com o registro original. Era possível introduzir o ID de um registro de outra agenda, reatribuir vínculos ou produzir colisões. | Validação de IDs, duplicatas e formato; comparação com registros originais ativos e cancelados; preservação dos registros não autorizados; restrição de transferências e novos vínculos. Testes de IDOR, proprietário forjado e colisões. |
| SEC-03 | Alta | `POST /api/workflow` obtinha o agendamento anterior globalmente, mas calculava a permissão principalmente pelo objeto proposto. Isso permitia associar uma solicitação autorizada a um registro original não autorizado. | Confere acesso ao original antes de usá-lo; restringe mudanças de ID, médico, anestesista e paciente; valida vínculos de criação. A aprovação revalida o original e recusa versões alteradas. Teste da rota com proprietário proposto forjado. |
| SEC-04 | Alta | A secretaria podia substituir `patientHistory` e campos não explicitamente protegidos pelo espalhamento de `proposed`. A inicialização sem estado também não exigia gerente. | Lista explícita de coleções; mesclagem partindo do estado do servidor; histórico existente preservado para secretaria; novas entradas limitadas aos pacientes autorizados; inicialização exclusiva da gerência. |
| SEC-05 | Alta | IDs vindos do estado/importação eram interpolados em atributos de HTML sem escape uniforme. Um valor malicioso poderia romper o atributo e introduzir marcação, atingindo outros usuários. | Escape dos IDs no JavaScript público, validação de identificadores na entrada e CSP com nonce e bloqueio de scripts em atributos. A CSP funciona como camada adicional; não substitui o escape. |
| SEC-06 | Alta | Dados clínicos completos eram gravados em `localStorage`, permanecendo no dispositivo após o uso. | Estado apenas em memória; remoção das chaves antigas ao carregar uma sessão autenticada; logout com limpeza de armazenamento/cache do navegador e revalidação ao restaurar página do histórico. Não apaga exportações anteriores nem alcança dispositivos que nunca voltarem ao sistema. |
| SEC-07 | Alta | Login sem limitação persistente de tentativas; endpoint público criava automaticamente um gerente para um e-mail fixo e mantinha fluxo de senha inicial. | Remoção do bootstrap público. Contador atômico no PostgreSQL, com limites por conta, IP na Vercel e global. Falhas do contador retornam 503. Mensagem genérica para credenciais inválidas. Não foi demonstrado login sem conhecer a senha inicial na versão antiga. |
| SEC-08 | Média | PBKDF2-SHA256 com 100 mil iterações e possibilidade de definir senha curta em atualização de conta. | Hash versionado com 600 mil iterações e salt aleatório; verificação dos hashes antigos e atualização após login correto. Novas senhas de 12 a 128 caracteres, validadas no servidor em criação e atualização. |
| SEC-09 | Alta | Troca de senha não invalidava explicitamente as sessões já existentes; sessões duravam sete dias. | Gatilho SQL de revogação ao alterar hash/salt/papel; revogação de sessões na administração de acessos; novas sessões de oito horas. Papéis desconhecidos são recusados e hashes de senha não são carregados na leitura comum da sessão. Sessões antigas não são retroativamente encurtadas somente pela mudança de código. |
| SEC-10 | Média | Ausência de política consistente de origem/tipo/tamanho nos endpoints mutáveis; logout por GET. | Validação de origem no próprio handler, sem depender exclusivamente de middleware; JSON obrigatório, leitura limitada em bytes e tratamento de erros; logout por POST. `APP_ORIGIN` ou domínios confiáveis fornecidos pela Vercel definem a origem em produção. |
| SEC-11 | Alta para integridade | Estado, decisão, notificação e auditoria eram gravados em operações separadas. Falha intermediária poderia deixar alteração sem registro ou decisão inconsistente. | Função SQL transacional com bloqueio, comparação de revisão, decisão única e auditoria/notificação na mesma transação. Testes PostgreSQL confirmam rollback integral em falha de auditoria, revisão obsoleta e decisão repetida. |
| SEC-12 | Média | Proteção de navegador e cache incompleta; cliente privilegiado sem barreira explícita contra importação no navegador. | `server-only`; chamadas ao Supabase via HTTPS, sem cache e sem seguir redirecionamentos; CSP, HSTS, `nosniff`, anti-iframe, política de referência e permissões. Respostas sensíveis com `no-store`. |
| SEC-13 | Média, com risco residual | Finalização do PDF podia conservar o mesmo caminho endereçado pela URL de upload; hash não representava necessariamente os bytes compactados publicados. O compactador aceitava detecção automática do formato da imagem. | Publicação em novo caminho aleatório escrito pelo servidor; hash dos bytes publicados; somente imagens com assinatura JPEG chegam ao processamento DCT; limite de envios/finalizações. PDFs continuam sem garantia antimalware. |
| SEC-14 | Média | Solicitações de médico eram selecionadas por autor, podendo sobreviver à revogação de uma agenda na listagem. Streams podiam ser abertos sem limite específico. | Solicitações também filtradas pelas agendas atuais; limite de abertura de streams por usuário; sessão e dados reconsultados durante a transmissão. Revogação não desfaz dados previamente recebidos. |
| SEC-15 | Alta/Média conforme pacote | Estrutura antiga Cloudflare/Vinext/D1 e dependências transitivas vulneráveis permaneceram após a migração. | Remoção da superfície de execução abandonada, incluindo exemplo de autenticação por cabeçalhos que não deve ser confiado na Vercel. Testes de componentes adaptados para TypeScript/React. Histórico Git conserva as versões anteriores. |

### Por que um `is_admin: true` não concede acesso

O navegador pode ser modificado pelo próprio usuário, inclusive para mostrar botões administrativos ou alterar uma resposta exibida. Isso não muda a conta associada ao cookie no servidor. A API consulta a sessão e o papel armazenados no banco; somente a gerência usa a rota de administração de contas. A API de estado rejeita campos de privilégio e papéis desconhecidos são recusados.

Um campo de papel ou booleano interno não é, por si só, uma vulnerabilidade. O defeito é confiar em um valor controlado pelo cliente para conceder poderes. A correção mantém papéis legítimos e testa as fronteiras no servidor.

### Consequências funcionais deliberadas

- A rota pública deixa de provisionar gerentes. As quatro contas existentes examinadas já possuíam hash e salt, incluindo os dois gerentes; nenhuma senha real foi lida ou exibida nessa checagem.
- Mudanças de acesso revogam sessões. O usuário afetado precisará entrar novamente.
- A secretaria não transfere registros entre profissionais por alteração de IDs. Criar vínculo novo entre agendas exige acesso às agendas envolvidas ou atuação da gerência.
- O cliente não pode inicializar um banco vazio sem papel de gerente.
- Não há mais recuperação automática de uma agenda clínica antiga em `localStorage`. O servidor é a origem dos dados.
- JSON fora do formato aceito, IDs inválidos, duplicatas e corpos acima do limite são recusados. Dados legados incompatíveis exigem análise antes de importação, sem relaxar a validação global.

## 4. Banco e armazenamento: situação realmente observada

No banco Agenda RN, as oito tabelas (`users`, `sessions`, `agenda_access`, `app_state`, `agenda_requests`, `notifications`, `audit_logs`, `surgery_documents`) apresentavam RLS ativado. Não foram observados grants para `anon`/`authenticated` nem políticas que liberassem essas tabelas. O bucket `surgery-documents` estava privado, com limite de 20 MiB e MIME permitido `application/pdf`.

O advisor retornou oito avisos informativos de RLS sem políticas. **Isso é coerente com o modelo de acesso exclusivo pelo backend; não foi tratado como autorização para abrir políticas públicas.** A chave de servidor ignora RLS: o isolamento entre usuários depende da aplicação. RLS, aqui, bloqueia clientes públicos, mas não elimina falhas de autorização da API privilegiada. [Documentação de RLS do Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).

A migração proposta cria uma tabela de contadores e funções `SECURITY INVOKER`, com `search_path` definido e execução revogada de `PUBLIC`, `anon` e `authenticated`. Os testes isolados comprovam essas recusas. **Esses novos objetos não existem por ação desta auditoria no banco de produção**, pois a aplicação da migração foi bloqueada pela revisão automática.

## 5. Camadas de proteção e seus limites

| Camada | Método implementado ou observado | Limite que permanece |
|---|---|---|
| Identidade | Senha derivada por PBKDF2 com salt; sessão aleatória validada no banco | Não há MFA para usuários finais; senha roubada continua sendo risco relevante |
| Força bruta | Contador PostgreSQL atômico: 10/conta/15 min, 30/IP/5 min na Vercel, 300 globais/min | Não substitui proteção de borda contra DDoS; limites podem causar indisponibilidade temporária sob ataque |
| Sessão | Cookie `HttpOnly`, `Secure`, `SameSite=Strict`; hash do token no banco; novas sessões de 8 h | Não existe expiração por inatividade; roubo de sessão em dispositivo comprometido exige revogação |
| Autorização | Papel e agendas consultados no servidor; validação do objeto original | Backend e chave privilegiada continuam pertencendo à base de confiança |
| Integridade | IDs/coleções validados; comparação de revisão; transação de agenda/decisão/auditoria | Criação de solicitação e administração de acessos ainda contêm operações separadas; precisam de evolução transacional |
| Navegador | Escape, CSP por nonce, bloqueio de script em atributo, anti-iframe, ausência de snapshot clínico persistente | Estilos inline permanecem permitidos pela interface legada; extensões e dispositivos comprometidos estão fora dessa proteção |
| Transporte | HTTPS obrigatório para o banco, validação TLS padrão, HSTS e recusa de redirects no cliente de banco | Não é criptografia ponta a ponta e não protege contra autoridades certificadoras/raízes locais comprometidas |
| Dados em repouso | Banco/bucket privados, chaves restritas ao servidor | Não houve prova independente da criptografia e das configurações de backup do provedor; não há criptografia de campo com chaves controladas pelo usuário |
| Documentos | Autorização por cirurgia, link de leitura de 60 s, limite de 20 MiB, caminho final próprio e hash | URL assinada é credencial temporária compartilhável; sem antivírus/CDR ou sandbox forte para parser PDF |
| Cadeia de dependências | Versões corrigidas, lockfile, auditoria de produção e desenvolvimento | Zero alertas é resultado de uma consulta, não prova contra falhas desconhecidas ou comprometimento de fornecedor |
| Auditoria | Registro de agendamentos e decisões, ligado à gravação transacional | Logs não são imutáveis contra administrador do banco; não cobrem integralmente leituras, downloads e todas as mudanças administrativas |

### Intermediário alterando a resposta da API

TLS autenticado protege a confidencialidade e a integridade entre os extremos da conexão. HSTS reduz downgrade para HTTP. A aplicação não desativa validação de certificados e o cliente do banco recusa redirecionamentos. As decisões de autorização continuam no servidor, de modo que trocar visualmente `role` ou uma resposta no navegador não concede acesso à API.

Isso **não** garante proteção quando o navegador, o dispositivo, o servidor, a chave privilegiada ou uma autoridade certificadora confiada estiverem comprometidos. Não foi implementada assinatura independente de cada resposta ou criptografia ponta a ponta, e o relatório não alega essas propriedades. Um hash de PDF detecta diferenças se comparado a uma referência confiável; não equivale a assinatura digital nem comprova que um arquivo seja benigno.

## 6. Riscos restantes e prioridades

**Antes de considerar a atualização ativa:** aprovar e aplicar a migração ao projeto correto; validar permissões reais das novas funções; configurar a origem; implantar o código; testar login, perfis, mudança de senha, anexos e revogação em ambiente controlado. A produção atual não deve ser declarada corrigida só porque a branch contém os patches.

**Prioridade alta:** implementar MFA na autenticação própria, sobretudo para gerência; configurar e verificar limites/WAF na borda; separar ambientes e impedir que previews exponham dados reais; definir backups e testar restauração; monitorar abuso de login e de upload. Para PDF, adicionar análise antimalware/CDR quando compatível com documentos assinados e processamento isolado com orçamento de memória/CPU. A compactação atual não é sanitização.

**Próxima evolução estrutural:** normalizar o estado clínico em tabelas com autorização por registro; reduzir o uso da chave privilegiada; tornar operações administrativas e criação de solicitações transacionais; auditar leituras/downloads; proteger logs contra alteração e definir retenção. O histórico clínico informado pelo cliente não deve ser interpretado como prova independente de autoria.

**Operação contínua:** revisitar permissões, remover contas não usadas, revogar sessões em incidentes, rotacionar segredos quando houver indício de exposição, acompanhar avisos de dependências, testar recuperação e controlar exportações/impressões. Não foram removidas exportações autorizadas: são saídas de dados que exigem governança. Esta auditoria não é certificação de conformidade jurídica.

## 7. Validação e reprodução

- Build de produção com Next.js 16.3.5: aprovado, incluindo TypeScript.
- Testes automatizados da aplicação: 50 aprovados, cobrindo também testes funcionais preexistentes.
- Banco isolado PostgreSQL/PGlite: bloqueio de tentativas, proibição de acesso público, revogação de sessão, rollback por falha de auditoria, comparação de revisão e recusa de decisão repetida aprovados.
- Navegador Chromium sobre build de produção e backend sintético: login, carregamento da agenda, ausência do snapshot em localStorage, cookie HttpOnly/SameSite, rejeição de origem externa, rejeição de `is_admin: true`, bloqueio de handler HTML injetado pela CSP e invalidação após logout aprovados. Essa execução não valida a infraestrutura de produção nem o fluxo completo de todos os perfis. As imagens binárias omitidas produziram 404 locais; não foram alteradas no repositório.
- Auditoria npm inicial: 24 pacotes sinalizados (1 crítico, 14 altos, 8 moderados e 1 baixo). Esses números contam pacotes, não 24 explorações demonstradas.
- Auditoria npm após correções: zero alertas conhecidos na consulta executada. O lockfile registra as versões transitivas resolvidas.
- Checagens de sintaxe dos scripts públicos e whitespace do patch: aprovadas.

Para reproduzir: `npm ci`, `npm run build`, `npm test` e `npm run test:db`. Não apontar testes sintéticos para a produção. Usar o arquivo de migração versionado; nunca substituir a referência do projeto por suposição.

## 8. Fontes técnicas

- [Next.js — aviso de execução remota no processamento AVIF](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4): versões afetadas e mitigação/correção do framework.
- [Sharp — vulnerabilidades herdadas de libheif](https://github.com/lovell/sharp/security/advisories/GHSA-rgj7-g3m4-5g8c): motivo para atualizar o processador nativo.
- [Next.js — atualização de segurança de julho de 2026](https://nextjs.org/blog/july-2026-security-release): condições de SSRF, bypass e falhas de cache/consumo de recursos; nem todas se aplicam aos recursos usados nesta aplicação.
- [Next.js — Content Security Policy](https://nextjs.org/docs/app/guides/content-security-policy): nonce por requisição e integração com renderização dinâmica.
- [OWASP — Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): referência para elevar o custo de PBKDF2-SHA256 e manter salt por senha.
- [Supabase — RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): diferença entre acesso público restrito e cliente de serviço privilegiado.
- [Supabase — advisor RLS sem políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy): explicação do aviso informativo observado.

O sigilo depende da combinação de código, identidade, infraestrutura, operação e dispositivos. A entrega documenta as defesas verificadas e as lacunas, sem prometer proteção total.
