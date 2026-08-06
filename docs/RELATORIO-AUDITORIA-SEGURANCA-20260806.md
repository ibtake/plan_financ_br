# Relatório de Auditoria de Segurança

**Projeto:** Planejador Financeiro  
**Data:** 6 de agosto de 2026  
**Escopo:** código-fonte local React/Vite, configuração Vercel, schema e migrações Supabase, Edge Function `admin-users`, dependências bloqueadas no `package-lock.json` e artefato de build local.  
**Método:** revisão estática manual, busca de padrões perigosos, inspeção de controles de autorização, `npm audit`, build Vite e validação de migrações. Não foram usados dados, credenciais ou painéis remotos.

## Resumo executivo

O projeto possui uma boa base de segurança para uma aplicação financeira: não há segredo versionado nem `service_role` no navegador, o banco define RLS e `FORCE ROW LEVEL SECURITY` para as seis tabelas da aplicação, as políticas vinculam as linhas a `auth.uid()`, e as funções sensíveis usam `SECURITY DEFINER` com `search_path` explícito. Não foram encontrados sinks de XSS como `dangerouslySetInnerHTML`, `eval`, `new Function` ou inserção direta de HTML.

Foram confirmados **sete achados**: um de severidade média, um alto restrito ao ambiente de desenvolvimento e cinco de severidade baixa/condicional. O risco mais relevante para o sistema publicado é o limite de corpo incompleto na Edge Function administrativa. A auditoria de produção de dependências retornou **zero vulnerabilidades**; a auditoria completa retornou uma alta e uma moderada, ambas transitivas do Vite/esbuild e restritas ao servidor de desenvolvimento.

**Nota atual (código local): 8,1/10.** A nota não cobre configurações remotas, backup, autenticação hospedada, variáveis de ambiente ou permissões efetivas do PostgreSQL.

## Metodologia e validações executadas

- Inventário de todos os arquivos fonte, configuração, migrações e Edge Functions.
- Busca por XSS/DOM injection, execução dinâmica, segredos, uso de Storage, chamadas de rede, RPCs e APIs administrativas.
- Revisão das políticas RLS, grants, triggers, constraints e funções `SECURITY DEFINER` do schema consolidado e das migrações.
- Revisão de autenticação, MFA, reset de senha, sessão, CORS, autorização administrativa e importação/exportação de dados.
- Inspeção de `vercel.json`, `vite.config.js`, `.gitignore`, `.env.example`, `robots.txt`, manifest e build local.
- `npm run deploy:check`: aprovado (build e validação das sete migrações).
- `npm audit --omit=dev --json`: 0 vulnerabilidades de produção.
- `npm audit --json`: 1 alta e 1 moderada, ambas em dependências de desenvolvimento Vite/esbuild.

## Achados confirmados

### A-01 - Limite de requisição da Edge Function pode ser contornado

**Severidade:** Média  
**Status:** Confirmado  
**Arquivo:** `supabase/functions/admin-users/index.ts:81-84,111`

A função compara apenas o cabeçalho `Content-Length` com 16 KB e depois executa `await request.json()`. `Content-Length` é controlável pelo cliente e pode estar ausente, incorreto ou não representar adequadamente um corpo transmitido em streaming. Assim, uma requisição autorizada pode obrigar a função a materializar um JSON maior em memória.

**Exploração e impacto:** um usuário com JWT válido e origem autorizada pode enviar repetidamente corpos grandes, elevando consumo de memória, latência e custo da Edge Function. O CORS não é uma barreira para um cliente não-navegador que já possua um token; o requisito de autenticação reduz, mas não elimina, o impacto.

**Correção recomendada:** ler o corpo como `ReadableStream`/`arrayBuffer` com contador real de bytes e interromper acima de `MAX_BODY_BYTES` antes de `JSON.parse`. Manter também a checagem de `Content-Length` como otimização. Testar requisições sem cabeçalho e acima do limite.

**Impacto da correção:** payloads válidos superiores a 16 KB passam a ser rejeitados com HTTP 413. O endpoint atual recebe apenas ações administrativas pequenas, portanto o impacto funcional esperado é nulo.

### A-02 - Dependências Vite/esbuild vulneráveis no ambiente de desenvolvimento

**Severidade:** Alta (exposição restrita ao desenvolvimento)  
**Status:** Confirmado  
**Arquivos:** `package.json`, `package-lock.json`  
**Versões resolvidas:** Vite 5.4.21 e esbuild transitivo.

O `npm audit` completo confirmou:

- Vite: GHSA-fx2h-pf6j-xcff (alta, bypass de `server.fs.deny` no Windows), GHSA-4w7w-66w2-5vf9 (path traversal de source maps de dependências otimizadas) e GHSA-v6wh-96g9-6wx3 (divulgação de hash NTLMv2 via UNC).
- esbuild: GHSA-67mh-4wv8-2f99 (origens arbitrárias podem enviar requisições ao dev server e ler a resposta).

O `npm audit --omit=dev` não encontrou vulnerabilidades; Vite e esbuild não integram o bundle final hospedado na Vercel. O risco se concentra em executar `npm run dev` em Windows, especialmente em rede não confiável ou expondo o servidor além de localhost.

**Correção recomendada:** planejar atualização compatível para Vite 8 e plugin React correspondente, revisar mudanças de major version e retestar build/desenvolvimento. Até a atualização, manter o servidor de desenvolvimento em `127.0.0.1`, não usar `--host 0.0.0.0` e não abrir projetos não confiáveis.

**Impacto da correção:** é atualização major e exige teste manual; não deve ser aplicada automaticamente durante esta auditoria.

### A-03 - Senha temporária administrativa é renderizada como texto visível

**Severidade:** Baixa  
**Status:** Confirmado  
**Arquivo:** `src/components/AdminUserManagement.jsx:100`

O campo de senha temporária usa `type="text"`, deixando a senha legível na tela enquanto é criada. A senha é forte e não é enviada a logs, mas pode ser exposta por observação local, compartilhamento de tela ou gravação.

**Correção recomendada:** usar `type="password"` por padrão e fornecer botão explícito de mostrar/ocultar. Mantenha o gerador e a recomendação de entrega por canal seguro.

**Impacto da correção:** reduz conveniência de copiar/conferir a senha; um botão de revelar controlado preserva a usabilidade.

### A-04 - CSP permite conexões a qualquer projeto Supabase

**Severidade:** Baixa  
**Status:** Confirmado  
**Arquivo:** `vercel.json:19`

`connect-src` permite `https://*.supabase.co` e `wss://*.supabase.co`. Não há XSS encontrado que torne isto explorável isoladamente, mas, caso um XSS seja introduzido no futuro, o curinga facilita exfiltração para projeto Supabase controlado por atacante.

**Correção recomendada:** fixar os hosts exatos de produção e homologação nas políticas de cada ambiente. Como `vercel.json` é estático, isso pode exigir projetos/configurações separados ou uma estratégia de headers por ambiente.

**Impacto da correção:** uma URL Supabase não listada deixará de funcionar; validar Preview e Production antes da publicação.

### A-05 - CSP mantém `style-src 'unsafe-inline'`

**Severidade:** Baixa  
**Status:** Confirmado / risco aceito anteriormente  
**Arquivo:** `vercel.json:19`

O aplicativo usa estilos inline e Recharts; por isso a política permite estilos inline. Isso reduz uma camada de defesa contra injeção baseada em CSS, mas não habilita scripts inline e não foi encontrado vetor de XSS no código.

**Correção recomendada:** somente em iniciativa dedicada: remover estilos inline, usar classes/CSS e avaliar nonce ou hash para estilos inevitáveis.

**Impacto da correção:** refatoração ampla, com risco visual; o ganho é de defesa em profundidade.

### A-06 - Endurecimento incompleto do schema `public` para funções SECURITY DEFINER

**Severidade:** Baixa, condicional ao ambiente  
**Status:** Confirmado no código; confirmação operacional pendente  
**Arquivo:** `supabase/schema.sql:39-44,110-204,293-365,692-752,762-848`

O schema remove privilégios de `anon`, mas não contém `REVOKE CREATE ON SCHEMA public FROM PUBLIC`. As funções SECURITY DEFINER fixam `search_path` como `public, pg_temp`, o que é melhor que um caminho implícito. Ainda assim, a ausência de uma revogação explícita deixa a segurança dependente da configuração efetiva do projeto Supabase.

As referências a tabelas críticas estão qualificadas com `public.` e as referências a autenticação com `auth.`, o que reduz a superfície de shadowing. O risco torna-se material apenas se o papel `PUBLIC` ou algum papel alcançável pelo atacante puder criar objetos no schema `public`.

**Correção recomendada:** verificar primeiro no projeto real:

```sql
select has_schema_privilege('public', 'public', 'CREATE') as public_can_create;
```

Se retornar verdadeiro, criar migração incremental que revogue `CREATE` de `PUBLIC` e conceda apenas o mínimo para os papéis administrativos necessários. Não aplicar o `REVOKE` sem homologação: ele pode afetar extensões ou ferramentas administrativas.

### A-07 - Ausência de rate limit específico na Edge Function administrativa

**Severidade:** Baixa  
**Status:** Confirmado  
**Arquivo:** `supabase/functions/admin-users/index.ts`

O endpoint exige JWT, origem configurada, UUID administrativo e AAL2 para ações de lista/criação; criação também exige MFA recente. Não existe, porém, cota por usuário/IP/ação no código. Uma sessão administrativa comprometida pode chamar `list-users` repetidamente ou provocar carga desnecessária.

**Correção recomendada:** adicionar rate limit no edge/runtime (por exemplo, limite de chamadas por admin e janela), com armazenamento apropriado e sem depender do cliente. Monitorar logs de invocação.

**Impacto da correção:** pode bloquear operações administrativas legítimas em lotes se os limites forem muito baixos; calibrar em homologação.

## Controles confirmados

| Área | Resultado |
|---|---|
| Segredos no repositório | Nenhum `.env` real lido/versionado; `.env.example` tem placeholders; `service_role` só é lida na Edge Function. |
| RLS | As tabelas `profiles`, `categories`, `transactions`, `budgets`, `goals` e `security_events` têm RLS habilitada e forçada no schema. |
| Isolamento | Políticas usam `auth.uid()` e verificações adicionais de token/MFA; triggers impedem troca de proprietário. |
| RPCs | `log_security_event`, `delete_my_data` e `replace_my_data` revogam execução de `public`/`anon` e concedem a `authenticated`. |
| MFA e sessão | O frontend usa PKCE, renovação de token, MFA TOTP, logout por inatividade e validação AAL. O banco contém controles de AAL e token. |
| Edge Function | A service role não chega ao navegador; o usuário vem de JWT validado, administradores vêm de allow-list de ambiente e CORS é baseado em origem permitida. |
| XSS/HTML injection | Nenhum uso encontrado de `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write` ou `insertAdjacentHTML`. React renderiza texto escapado. |
| Importação e exportação | JSON tem limite, saneamento contra prototype pollution e limites de coleção; CSV neutraliza prefixos de fórmula. |
| Upload de ícones | Aceita PNG/WEBP até 1 MB, redesenha em canvas e persiste somente PNG data URL validado. |
| Logs | O usuário só lê os próprios eventos; não há update/delete direto; detalhes são saneados para não registrar senha, token, TOTP ou segredo; há retenção solicitada de sete dias. |
| Headers | CSP, HSTS, anti-frame, `nosniff`, Referrer/Permissions Policy, COOP/CORP e `X-Robots-Tag` estão definidos. |
| Build | Não foram encontrados source maps no diretório `dist` gerado localmente. |

## Itens descartados no código

- Não há API Routes, SSR ou backend próprio além da Edge Function; SSRF por URL fornecida pelo usuário não se aplica ao código atual.
- Não há uso de Supabase Storage no código, logo não existe bucket/policy de Storage a revisar localmente.
- Não há endpoint `/api/test`, `/api/debug` ou rota equivalente no repositório.
- Não foi encontrada confiança em `user_id` de request para conceder privilégios na Edge Function; a identidade vem de `auth.getUser(token)` e claims.
- Não há SQL dinâmico, concatenação de SQL ou execução de SQL a partir de entrada do usuário nas funções revisadas.
- Não há vulnerabilidades conhecidas nas dependências de produção conforme o `npm audit --omit=dev` executado nesta data.

## Checklist OWASP Top 10 (visão de código)

| Categoria | Situação |
|---|---|
| A01 - Broken Access Control | Bom no código: RLS, `auth.uid()`, MFA e triggers. Confirmar políticas efetivas em produção. |
| A02 - Cryptographic Failures | Bom: segredos fora do frontend; HTTPS é exigido. Confirmar TLS/domínios e rotação de chaves no painel. |
| A03 - Injection | Bom: sem sinks de HTML/JS/SQL; importação e CSV endurecidos. |
| A04 - Insecure Design | Atenção: A-01 e A-07 exigem limites server-side. |
| A05 - Security Misconfiguration | Atenção: A-04, A-05 e A-06; há boa base de headers. |
| A06 - Vulnerable Components | Atenção: A-02 em dev; produção sem alertas atuais. |
| A07 - Authentication Failures | Bom no código: PKCE, MFA, AAL e sessão inativa; confirmar rate limits do Auth remoto. |
| A08 - Software and Data Integrity | Bom: importação transacional e validação JSON; proteger pipeline/GitHub continua necessário. |
| A09 - Logging and Monitoring Failures | Bom: logs imutáveis, saneados e com retenção; monitoramento remoto ainda é operacional. |
| A10 - SSRF | Não aplicável ao código atual. |

## Verificações obrigatórias no painel (não auditáveis localmente)

1. Supabase: confirmar que as migrações V04 a V10 estão aplicadas no projeto correto e que RLS/policies efetivas correspondem ao schema.
2. Supabase: executar a consulta de `has_schema_privilege` descrita em A-06 antes de qualquer migração de privilégio.
3. Supabase Auth: confirmar cadastro público desligado, URLs de redirect restritas e rate limits de login, recuperação de senha e MFA configurados.
4. Supabase: confirmar que não há buckets Storage públicos/manualmente criados e que não há RPCs, views ou tabelas adicionais fora do versionamento.
5. Edge Function: confirmar que `APP_ALLOWED_ORIGINS` contém somente origens HTTPS esperadas e que `APP_ADMIN_USER_IDS` contém UUIDs atuais; não registrar esses valores no repositório.
6. Vercel: confirmar que Preview usa homologação, Production usa produção, variáveis públicas contêm somente URL e anon key, e Preview Deployments exigem autenticação quando apropriado.
7. Vercel: confirmar que o deployment final aplica os headers configurados e que não publica source maps.
8. Operação: manter backup/PITR testado, monitorar invocações da Edge Function e configurar atualização de dependências (Dependabot/Renovate ou rotina equivalente).

## Plano de priorização

1. Corrigir A-01 antes de ampliar o uso da Edge Function administrativa.
2. Planejar atualização Vite/plugin para eliminar A-02; até lá, restringir o dev server a localhost.
3. Corrigir A-03 junto à próxima melhoria da tela administrativa.
4. Confirmar A-06 e os itens remotos; depois decidir a migração de privilégios necessária.
5. Avaliar A-04, A-05 e A-07 como hardening de defesa em profundidade.

## Limitações

Este relatório não declara que Supabase ou Vercel foram auditados em produção. Não houve login em painéis, execução de SQL, leitura de `.env`, teste de RLS com dois usuários, varredura dinâmica, pentest autenticado, análise de tráfego, análise de infraestrutura, nem alteração de código. Os itens condicionais e operacionais devem ser confirmados antes de declarar conformidade de produção.
