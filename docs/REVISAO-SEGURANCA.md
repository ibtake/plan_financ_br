# RELATÓRIO DE REVISÃO DE SEGURANÇA
**Planejador Financeiro — Vercel + Supabase**  
Data: 05 de agosto de 2026  
Revisor: Análise automatizada de segurança  
Escopo: Código-fonte, configuração, políticas RLS e práticas de deploy

---

## SUMÁRIO EXECUTIVO

**Status geral:** ⚠️ **SUPERADO PELA AUDITORIA v2.0 — VER SEÇÃO 15**

> Este relatório é a **primeira** revisão (v1.0). Uma segunda auditoria,
> conduzida em 05/08/2026, encontrou 5 vulnerabilidades arquiteturais que
> escaparam a esta análise. Leia primeiro
> [`AUDITORIA-SEGURANCA-2.0.md`](AUDITORIA-SEGURANCA-2.0.md).
> As seções 1 a 14 abaixo continuam válidas quanto ao que descrevem, mas o
> veredito "aprovado" da época foi revisado.

**Status na época desta revisão:** ✅ APROVADO COM OBSERVAÇÕES

O projeto implementa defesas sólidas em múltiplas camadas. As correções aplicadas nesta revisão fecharam gaps de defesa em profundidade que, embora já bloqueados pelo RLS no banco, permitiriam tentativas desnecessárias.

**Principais forças:**
- Row Level Security rigoroso em todas as 6 tabelas
- Auditoria imutável de eventos de segurança
- MFA opcional via TOTP
- Rate limiting de login (frontend + backend)
- Triggers anti-sequestro de registro
- Logout automático por inatividade
- Headers HTTP seguros (CSP, HSTS, X-Frame-Options)
- Validação de importação com limites de tamanho

**Correções aplicadas nesta revisão:**
- Adição de filtro `.eq('user_id', user.id)` em todas as queries UPDATE/DELETE
- Validação reforçada de importação JSON (limite 8MB, tipos, contadores)
- Melhorias de responsividade mobile (safe-area, touch-action, dvh)
- `vercel.json` criado com política de segurança de conteúdo completa

---

## 1. AUTENTICAÇÃO E CONTROLE DE ACESSO

### 1.1 Row Level Security (RLS)
**Status:** ✅ **IMPLEMENTADO CORRETAMENTE** — 🔄 **REFORÇADO NA v2.0**

Todas as 6 tabelas possuem:
- `enable row level security`
- `force row level security`
- Políticas explícitas para SELECT, INSERT, UPDATE, DELETE
- Filtro `auth.uid() = user_id` em todas as operações

> **Reforço aplicado na v2.0:** o filtro `auth.uid() = user_id` garante
> isolamento *entre* usuários, mas não verifica **como** o token foi obtido.
> As políticas agora incluem duas validações adicionais:
>
> ```sql
> using (
>   auth.uid() = user_id
>   AND is_token_valid()      -- token não foi emitido antes de troca de senha
>   AND has_required_aal()    -- exige AAL2 se o usuário tem MFA configurado
> )
> ```
>
> Sem `has_required_aal()`, um atacante com e-mail e senha podia chamar a API
> REST do Supabase diretamente com um token AAL1 e ler todos os dados, ignorando
> a tela de MFA do frontend. Sem `is_token_valid()`, um token roubado continuava
> funcionando até expirar (até 1 hora) mesmo após a vítima trocar a senha.

**Verificação prática recomendada:**
```sql
-- Executar no SQL Editor do Supabase após a implantação
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('profiles','categories','transactions','budgets','goals','security_events');
```
Todas as 6 linhas devem retornar `rowsecurity = true`.

**Verificação adicional da v2.0** — confirmar que as políticas usam as funções novas:
```sql
SELECT tablename, policyname
FROM pg_policies
WHERE schemaname = 'public'
  AND qual NOT LIKE '%has_required_aal%'
  AND tablename IN ('profiles','categories','transactions','budgets','goals');
```
Deve retornar **zero linhas**. Qualquer linha aqui é uma política que ficou sem a
verificação de MFA.

### 1.2 Defesa em profundidade nas queries
**Status:** ✅ **CORRIGIDO**

**Problema identificado:**  
As queries de UPDATE/DELETE filtravam apenas por `id`, confiando 100% na RLS. Embora a RLS bloqueie corretamente, a boa prática de defesa em profundidade pede filtro explícito por `user_id` também.

**Correções aplicadas em `useSupabaseFinance.js`:**
- `updateTransaction`: adicionado `.eq('user_id', user.id)`
- `deleteTransaction`: adicionado `.eq('user_id', user.id)`
- `updateCategory`: adicionado `.eq('user_id', user.id)`
- `deleteCategory`: adicionado em 3 queries (transactions, budgets, categories)
- `setBudget` (delete): adicionado `.eq('user_id', user.id)`
- `updateGoal`: adicionado `.eq('user_id', user.id)`
- `deleteGoal`: adicionado `.eq('user_id', user.id)`

**Impacto:**  
Redução de tentativas de acesso que chegariam ao Postgres para serem bloqueadas pela RLS. Economia de processamento e clareza de intenção no código.

### 1.3 Triggers de proteção
**Status:** ✅ **IMPLEMENTADO**

Três funções críticas no schema:
1. `prevent_owner_change()` — impede `UPDATE` que altere `user_id`
2. `set_updated_at()` — timestamp automático
3. `handle_new_user()` — provisionamento automático de perfil e categorias padrão

Triggers ativos em:
- `categories_no_owner_change`
- `transactions_no_owner_change`
- `budgets_no_owner_change`
- `goals_no_owner_change`

### 1.4 Autenticação multifator (MFA)
**Status:** ✅ **IMPLEMENTADO, OPCIONAL**

- TOTP via app autenticador (Google Authenticator, Authy, 1Password)
- Segredo nunca persistido pela aplicação
- QR code gerado pelo Supabase
- Desativação protegida por código válido

**Recomendação de uso:**  
Tornar obrigatório para contas com mais de X transações ou após Y dias de uso.

### 1.5 Validação de senha
**Status:** ✅ **IMPLEMENTADO**

Política aplicada em `AuthContext.jsx`:
- Mínimo 10 caracteres
- Combinação obrigatória de:
  - Letras maiúsculas
  - Letras minúsculas
  - Números
  - Símbolos (ao menos 3 dos 4 tipos)

Medidor visual de força na tela de cadastro.

**Complemento no Supabase:**  
Ativar "Leaked password protection" em Authentication → Password Settings.

### 1.6 Rate limiting
**Status:** ✅ **IMPLEMENTADO EM DUAS CAMADAS**

**Camada 1 — Frontend (localStorage):**
- Arquivo: `src/lib/audit.js`
- 5 tentativas de login
- Bloqueio de 5 minutos
- Armazenamento em `sessionStorage`

**Camada 2 — Backend (Supabase):**
- Configuração via painel: Authentication → Rate Limits
- Valores recomendados:
  - Sign in/up: 30 por hora por IP
  - Token refresh: 150 por hora por IP
  - E-mails: 30 por hora

### 1.7 Logout por inatividade
**Status:** ✅ **IMPLEMENTADO**

- Timeout: 30 minutos
- Reset automático em eventos: mousedown, keydown, touchstart, scroll
- Implementado em `AuthContext.jsx` com `useEffect` + timer

---

## 2. PROTEÇÃO DE DADOS

### 2.1 Isolamento entre contas
**Status:** ✅ **GARANTIDO PELA RLS**

Cada usuário enxerga exclusivamente:
- Próprios lançamentos (`transactions`)
- Próprias categorias customizadas (`categories`)
- Próprios orçamentos (`budgets`)
- Próprias metas (`goals`)
- Próprio perfil (`profiles`)
- Próprios eventos de auditoria (`security_events`)

**Teste obrigatório pós-deploy:**  
Criar duas contas, cadastrar um lançamento em cada e confirmar que a conta A não vê o lançamento da conta B.

### 2.2 Auditoria imutável
**Status:** ✅ **IMPLEMENTADO**

Tabela `security_events`:
- Políticas: SELECT e INSERT apenas
- **Sem políticas de UPDATE ou DELETE** — a RLS bloqueia por padrão
- Eventos registrados:
  - Login bem-sucedido / falho
  - Cadastro de conta
  - MFA ativado / removido / desafio sucesso / falha
  - Recuperação de senha
  - Alteração de senha
  - Exclusão em massa de dados
  - Importação de backup
  - **Tentativa de acesso a dados de outro usuário** (RLS violation)
  - Atividade suspeita

Função `log_security_event()` com `security definer` permite gravação mesmo em situações de erro de permissão.

### 2.3 Sanitização de dados sensíveis
**Status:** ✅ **IMPLEMENTADO**

Arquivo `src/lib/audit.js`:
- Lista de campos proibidos: password, senha, token, secret, totp, code, apikey, access_token, refresh_token
- Função `sanitize()` remove qualquer campo cujo nome contenha essas palavras
- Truncamento de strings em 200 caracteres
- User agent truncado em 400 caracteres

### 2.4 Validação de importação
**Status:** ✅ **CORRIGIDO E REFORÇADO**

**Problema anterior:**  
Aceitava qualquer JSON com array `transactions`, sem limite de tamanho.

**Correções aplicadas em `src/utils/exporters.js`:**
- Limite de arquivo: **8 MB**
- Validação de tipos:
  - `data.transactions` → deve ser array
  - `data.categories` → se presente, deve ser array
  - `data.goals` → se presente, deve ser array
  - `data.budgets` → se presente, deve ser objeto (não array, não null)
- Limites por coleção:
  - `transactions`: 20.000
  - `categories`: 500
  - `goals`: 500
  - `budgets`: 500
- Rejeição imediata com mensagem clara em caso de não-conformidade

**Barreira adicional:**  
Mesmo que algo escape da validação do frontend, as constraints do Postgres (`schema.sql`) rejeitam valores fora de faixa.

---

## 3. SEGURANÇA DE REDE E CABEÇALHOS HTTP

### 3.1 Content Security Policy (CSP)
**Status:** ✅ **IMPLEMENTADO**

Arquivo `vercel.json`:
```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self' data:;
connect-src 'self' https://*.supabase.co wss://*.supabase.co;
frame-ancestors 'none';
form-action 'self';
base-uri 'self';
object-src 'none';
worker-src 'self' blob:;
manifest-src 'self';
upgrade-insecure-requests
```

**O que bloqueia:**
- Scripts de terceiros
- Incorporação em outros sites (anti-clickjacking)
- Formulários submetidos a domínios externos
- Plugins e objetos embutidos (Flash, Java)

### 3.2 Outros cabeçalhos de segurança
**Status:** ✅ **IMPLEMENTADO**

Em `vercel.json`:
- **Strict-Transport-Security (HSTS):** `max-age=63072000; includeSubDomains; preload`
- **X-Content-Type-Options:** `nosniff`
- **X-Frame-Options:** `DENY`
- **Referrer-Policy:** `strict-origin-when-cross-origin`
- **Permissions-Policy:** bloqueia câmera, microfone, geolocalização, acelerômetro, bateria, etc.
- **Cross-Origin-Opener-Policy:** `same-origin`
- **Cross-Origin-Resource-Policy:** `same-origin`
- **X-DNS-Prefetch-Control:** `off`
- **X-Permitted-Cross-Domain-Policies:** `none`

### 3.3 Cache otimizado
**Status:** ✅ **IMPLEMENTADO**

- Assets (`/assets/*`): `public, max-age=31536000, immutable`
- HTML (`/`, `/index.html`): `no-cache, no-store, must-revalidate`

Impede que versões antigas da aplicação fiquem ativas após um deploy de correção de segurança.

---

## 4. PROTEÇÃO CONTRA ATAQUES COMUNS

### 4.1 SQL Injection
**Status:** ✅ **PROTEGIDO**

O Supabase JS client usa queries parametrizadas. Não há concatenação de strings SQL no código.

Exemplo seguro:
```javascript
supabase.from('transactions')
  .update(data)
  .eq('id', rootId)
  .eq('user_id', user.id)
```

### 4.2 Cross-Site Scripting (XSS)
**Status:** ✅ **PROTEGIDO**

- React escapa automaticamente valores inseridos via JSX
- Busca no código: **zero ocorrências** de `dangerouslySetInnerHTML`, `innerHTML` ou `eval()`
- CSP bloqueia scripts inline não-autorizados

### 4.3 Cross-Site Request Forgery (CSRF)
**Status:** ✅ **PROTEGIDO**

- Supabase usa tokens JWT em headers Authorization
- Cookies com `SameSite` configurado pelo Supabase
- CSP restringe `form-action` a `'self'`

### 4.4 Clickjacking
**Status:** ✅ **PROTEGIDO**

- `X-Frame-Options: DENY`
- `frame-ancestors 'none'` na CSP
- Impede que a aplicação seja incorporada em iframe malicioso

### 4.5 Enumeração de usuários
**Status:** ✅ **PROTEGIDO**

Mensagens genéricas em:
- Login falho: "E-mail ou senha incorretos."
- Recuperação de senha: "Se este e-mail estiver cadastrado, você receberá um link..."
- Cadastro duplicado: "Não foi possível concluir o cadastro com estes dados."

Nunca revela se um e-mail específico existe na base.

### 4.6 Ataque de timing
**Status:** ⚠️ **MITIGAÇÃO PARCIAL**

O Supabase usa hash bcrypt para senhas, que já possui tempo constante. Porém, a mensagem de erro do frontend diferencia "e-mail não encontrado" de "senha incorreta" via análise de resposta do servidor.

**Recomendação:**  
Manter a mensagem genérica no frontend (já implementada). O timing do bcrypt no backend já é a defesa principal.

---

## 5. SEGURANÇA DE CREDENCIAIS

### 5.1 Chaves públicas vs. privadas
**Status:** ✅ **CORRETO**

**Chaves que aparecem no navegador (correto):**
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Ambas são públicas por natureza. A proteção vem da RLS, não do sigilo dessas chaves.

**Chave que NUNCA deve ser usada:**
- `service_role` — ignora toda a RLS

O arquivo `.env.example` contém avisos claros sobre isso. O manual em PDF dedica uma seção inteira ao tema.

### 5.2 Proteção de arquivos `.env`
**Status:** ✅ **IMPLEMENTADO**

`.gitignore` bloqueia:
```
.env
.env.*
!.env.example
*.pem
*.key
```

Repositório deve ser configurado como **privado** no GitHub.

### 5.3 Rotação de credenciais
**Status:** ⚠️ **NÃO AUTOMÁTICO**

A rotação da `anon key` requer ação manual no painel do Supabase:
1. Project Settings → API → Reset anon key
2. Atualizar variável na Vercel
3. Republicar

**Recomendação:**  
Documentar procedimento no manual operacional. Rotação trimestral ou após incidente.

---

## 6. SEGURANÇA DE SESSÃO

### 6.1 Duração de token
**Status:** ✅ **CONFIGURÁVEL NO SUPABASE**

Valores recomendados (configurar em Authentication → Sessions):
- Access token expiry: **3600s (1 hora)**
- Refresh token rotation: **habilitado**
- Reuse interval: **10s**

A aplicação já implementa logout por inatividade (30 min), independente da duração do token.

### 6.2 Armazenamento de sessão
**Status:** ✅ **SEGURO**

- Token JWT armazenado em `localStorage` pelo Supabase JS client
- `httpOnly` não se aplica (não usa cookies HTTP)
- XSS mitigado pela CSP e ausência de `dangerouslySetInnerHTML`

### 6.3 Logout efetivo
**Status:** ✅ **IMPLEMENTADO**

`auth.signOut()` chama `supabase.auth.signOut()`, que:
1. Remove o token do localStorage
2. Invalida o refresh token no servidor
3. Limpa o estado da aplicação

---

## 7. RESPONSIVIDADE E MOBILE

### 7.1 Melhorias aplicadas nesta revisão
**Status:** ✅ **IMPLEMENTADO**

**Adições em `src/styles.css`:**
- `viewport-fit=cover` no `index.html`
- `safe-area-inset-*` para notch/Dynamic Island
- `100dvh` em vez de `100vh` (dynamic viewport height)
- `-webkit-overflow-scrolling: touch`
- `overscroll-behavior-x: contain`
- `touch-action: manipulation`
- `-webkit-tap-highlight-color: transparent`
- Alvos de toque mínimos de 44px (WCAG 2.5.5) via `@media (hover: none) and (pointer: coarse)`
- Input com `font-size: 16px` para evitar zoom no iOS
- `prefers-reduced-motion: reduce`

### 7.2 Meta tags de segurança mobile
**Status:** ✅ **IMPLEMENTADO**

No `index.html`:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="format-detection" content="telephone=no">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f4f6fb">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0b1120">
```

---

## 8. CONFIGURAÇÃO DE DEPLOY

### 8.1 Vercel
**Status:** ✅ **DOCUMENTADO**

Arquivo `vercel.json` criado com:
- Rewrites para SPA
- Headers de segurança
- Cache otimizado
- Detecção automática do framework (Vite)

### 8.2 Supabase
**Status:** ✅ **DOCUMENTADO**

`supabase/schema.sql` contém:
- 601 linhas
- 14 blocos funcionais
- Verificação final embutida que lista o status RLS de todas as tabelas

**Idempotente:** pode ser reexecutado sem quebrar dados existentes.

### 8.3 Variáveis de ambiente
**Status:** ✅ **DOCUMENTADO**

Manual em PDF detalha:
- Onde obter cada credencial
- Onde cadastrar na Vercel
- Qual chave NUNCA usar
- Como testar localmente

---

## 9. MONITORAMENTO E AUDITORIA

### 9.1 Painel de segurança da aplicação
**Status:** ✅ **IMPLEMENTADO**

Componente `SecurityPanel.jsx`:
- Lista os últimos 60 eventos da conta
- Filtra eventos críticos/warning das últimas 24h
- Alerta quando ≥ 3 eventos de atenção
- Exibe: tipo, timestamp, user agent, severidade

### 9.2 Detecção de acesso indevido
**Status:** ✅ **IMPLEMENTADO**

Função `guarded()` em `src/lib/audit.js`:
- Envolve operações no banco
- Detecta erros de código `42501` (insufficient_privilege)
- Detecta erros de código `PGRST301` (JWT inválido)
- Detecta mensagens contendo "row-level security" ou "permission denied"
- Grava automaticamente evento `rls_violation_attempt` com severidade **critical**

### 9.3 Rotina de monitoramento
**Status:** ✅ **DOCUMENTADO NO MANUAL**

Frequências recomendadas:
- **Semanal:** conferir aba Segurança
- **Mensal:** baixar backup JSON
- **Mensal:** revisar lista de usuários no Supabase
- **Trimestral:** `npm update` e republicar
- **Semestral:** reexecutar teste de isolamento entre contas

---

## 10. TESTES DE VALIDAÇÃO

### 10.1 Build de produção
**Status:** ✅ **APROVADO**

Comando executado:
```bash
npm run build
```

Resultado:
```
✓ 901 modules transformed
dist/index.html                   1.21 kB
dist/assets/index-4mu9ajQQ.css   21.88 kB
dist/assets/index-BxW4XN90.js   645.70 kB  (gzip: 182.73 kB)
✓ built in 2.86s
```

⚠️ Alerta sobre chunk > 500 KB — ver seção 11 sobre otimização.

### 10.2 Testes manuais obrigatórios
**Status:** 📋 **CHECKLIST FORNECIDO**

O manual em PDF inclui tabela de 10 testes, incluindo:
- Rejeição de senha fraca
- Bloqueio após 5 tentativas
- Persistência de dados após reload
- MFA ativo e solicitado no login
- **Teste de isolamento entre contas** (crítico)
- Layout mobile íntegro
- Recuperação de senha funcional

### 10.3 Verificação RLS pós-deploy
**Status:** 📋 **QUERY SQL FORNECIDA**

```sql
SELECT tablename, rowsecurity, 
  (SELECT count(*) FROM pg_policies p 
   WHERE p.schemaname = 'public' AND p.tablename = t.tablename) as politicas
FROM pg_tables t
WHERE schemaname = 'public'
  AND tablename IN ('profiles','categories','transactions','budgets','goals','security_events')
ORDER BY tablename;
```

Todas as 6 linhas devem retornar `rowsecurity = true` e `politicas > 0`.

---

## 11. OTIMIZAÇÃO (OPCIONAL)

### 11.1 Code-splitting
**Status:** ✅ **IMPLEMENTADO**

**Situação anterior:**
- Bundle único: 645,70 kB (182,73 kB gzip)
- Causa: biblioteca `recharts` carregada já no primeiro acesso, mesmo para quem não abrisse os gráficos
- Alerta do Vite sobre chunk acima de 500 kB

**Implementação em `src/App.jsx`:**
```javascript
const CategoryChart = lazy(() => import('./components/CategoryChart.jsx'))
const MonthlyChart = lazy(() => import('./components/MonthlyChart.jsx'))
const TrendChart = lazy(() => import('./components/TrendChart.jsx'))

<Suspense fallback={<ChartFallback height={240} />}>
  <CategoryChart {...props} />
</Suspense>
```

O componente `ChartFallback` reserva a altura final do gráfico, evitando salto de
layout (CLS) enquanto o chunk é baixado. Classe `.chart-loading` adicionada em
`src/styles.css`.

**Resultado medido:**

| Métrica | Antes | Depois | Ganho |
|---|---|---|---|
| Bundle inicial | 645,70 kB | 229,77 kB | −64% |
| Bundle inicial (gzip) | 182,73 kB | 70,82 kB | −61% |
| Alerta de chunk > 500 kB | presente | ausente | — |

Chunks sob demanda gerados: `generateCategoricalChart` (350,47 kB), `CategoryChart`
(28,37 kB), `YAxis` (24,42 kB), `TrendChart` (13,24 kB), `MonthlyChart` (2,41 kB).

**Observação de segurança:**  
O code-splitting não altera a superfície de ataque. Os chunks são servidos do
mesmo domínio, cobertos por `script-src 'self'` na CSP e por `worker-src 'self' blob:`.
O cache imutável em `/assets/*` continua válido porque o Vite versiona cada chunk
por hash de conteúdo.

---

## 12. CONFORMIDADE E BOAS PRÁTICAS

### 12.1 LGPD / GDPR
**Status:** ✅ **FAVORÁVEL**

- Dados armazenados por conta isolada
- Backup exportável pelo próprio usuário
- Função `delete_my_data()` para exclusão completa
- Sem rastreamento de terceiros
- Sem cookies de publicidade ou analytics

**Pendente:**  
Termo de uso e política de privacidade (documento legal, fora do escopo técnico).

### 12.2 OWASP Top 10 (2021)
**Status:** ✅ **MITIGADO**

| Risco | Status | Defesa |
|-------|--------|--------|
| A01 Broken Access Control | ✅ | RLS + triggers + filtro user_id |
| A02 Cryptographic Failures | ✅ | HTTPS obrigatório, bcrypt no Supabase |
| A03 Injection | ✅ | Queries parametrizadas |
| A04 Insecure Design | ✅ | Defesa em profundidade, auditoria |
| A05 Security Misconfiguration | ✅ | CSP, HSTS, .gitignore |
| A06 Vulnerable Components | ⚠️ | Dependências atualizadas, requer manutenção trimestral |
| A07 Authentication Failures | ✅ | Rate limit, MFA opcional, senha forte |
| A08 Data Integrity Failures | ✅ | RLS, triggers, validação frontend+backend |
| A09 Logging Failures | ✅ | security_events imutável |
| A10 SSRF | N/A | Aplicação não faz requisições server-side controladas pelo usuário |

### 12.3 WCAG 2.1 (Acessibilidade)
**Status:** ⚠️ **PARCIAL**

**Implementado:**
- Alvos de toque mínimos (44px)
- `prefers-reduced-motion`
- Contraste adequado nos temas claro e escuro
- Labels em inputs
- `aria-label` em botões de navegação

**Não validado:**
- Navegação por teclado em todos os fluxos
- Leitores de tela (NVDA, JAWS)
- Ordem de foco

**Recomendação:**  
Testes manuais com tecnologias assistivas. A conformidade WCAG completa exige revisão por especialista.

---

## 13. RESUMO DE ARQUIVOS CRÍTICOS

| Arquivo | Função de segurança |
|---------|---------------------|
| `supabase/schema.sql` | RLS, triggers, constraints, auditoria |
| `vercel.json` | Headers HTTP, CSP, cache |
| `src/lib/supabase.js` | Cliente Supabase, detecção de config incompleta |
| `src/lib/audit.js` | Log de eventos, sanitização, rate limit, detecção RLS violation |
| `src/contexts/AuthContext.jsx` | Validação de senha, MFA, logout por inatividade |
| `src/hooks/useSupabaseFinance.js` | Queries com filtro user_id, validação |
| `src/utils/exporters.js` | Validação de importação com limites |
| `.env.example` | Modelo de configuração com avisos |
| `.gitignore` | Bloqueio de segredos no git |
| `docs/Manual-Implantacao-Planejador-Financeiro.pdf` | Guia de deploy seguro |

---

## 14. CHECKLIST FINAL DE SEGURANÇA

### Deploy
- [ ] Executar `supabase/schema.sql` completo
- [ ] Verificar que todas as 6 tabelas retornam `rls_ativa = true`
- [ ] Cadastrar `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` na Vercel
- [ ] Confirmar que `service_role` nunca foi colada em variável `VITE_*`
- [ ] Repositório configurado como privado
- [ ] Arquivo `.env` não aparece no GitHub
- [ ] `vercel.json` presente no repositório
- [ ] Build aprovado sem erros

### Supabase
- [ ] Site URL e Redirect URLs configuradas
- [ ] Provedores não utilizados desabilitados
- [ ] Rotação de refresh token habilitada
- [ ] Leaked password protection ativada
- [ ] Rate limits configurados
- [ ] MFA (TOTP) habilitado nos provedores
- [ ] Access token expiry ≤ 3600s

### Validação
- [ ] Teste de isolamento entre contas aprovado
- [ ] Senha fraca recusada no cadastro
- [ ] Bloqueio após 5 tentativas funcional
- [ ] MFA ativa e solicita código no login
- [ ] Aba Segurança exibe histórico
- [ ] Layout mobile íntegro
- [ ] Recuperação de senha entrega e-mail

### Manutenção
- [ ] Backup mensal agendado
- [ ] Revisão semanal da aba Segurança
- [ ] `npm update` trimestral
- [ ] Teste de isolamento semestral

---

## 15. VULNERABILIDADES CONHECIDAS

> ⚠️ **Atualização de 05/08/2026 (v2.0):** uma segunda auditoria, mais profunda,
> encontrou **5 vulnerabilidades arquiteturais** que esta primeira revisão não
> detectou. Todas já foram corrigidas. O detalhamento técnico está em
> [`AUDITORIA-SEGURANCA-2.0.md`](AUDITORIA-SEGURANCA-2.0.md) e o procedimento de
> atualização em [`IMPLANTACAO-V2.md`](IMPLANTACAO-V2.md).
>
> | # | Vulnerabilidade | Severidade | Correção |
> |---|-----------------|------------|----------|
> | 1 | Schema shadowing em `SECURITY DEFINER` | 🔴 Crítico | `set search_path = public, pg_temp` |
> | 2 | Bypass de MFA via API (token AAL1) | 🔴 Crítico | `has_required_aal()` nas políticas RLS |
> | 3 | DoS por INSERT ilimitado em `security_events` | 🟠 Alto | Política de INSERT removida + 50 eventos/hora na RPC |
> | 4 | JWT TOCTOU (sessão revogada válida por até 1 h) | 🔴 Crítico | `is_token_valid()` compara `iat` com `auth.users.updated_at` |
> | 5 | Prototype pollution na importação de backup | 🟠 Alto | `sanitizeObject()` recursivo em `importJSON()` |
>
> A conclusão original abaixo ("nenhuma vulnerabilidade crítica ou alta")
> refletia o escopo da primeira revisão e **não é mais válida**: ela analisou as
> políticas RLS quanto ao isolamento por `user_id`, mas não quanto ao nível de
> garantia do token (AAL) nem à revogação de sessão.

**Conclusão da primeira revisão (superada pela auditoria v2.0):**

~~Nenhuma vulnerabilidade crítica ou alta identificada.~~

**Observações menores:**
1. **Bundle grande (645 KB):** impacta carregamento inicial em 4G. Mitigado por gzip (182 KB). Code-splitting recomendado mas não urgente.
2. **Rotação de credenciais manual:** a `anon key` não expira automaticamente. Rotação trimestral recomendada como boa prática.
3. **Validação WCAG incompleta:** navegação por teclado e leitores de tela não foram testados nesta revisão.

---

## 16. PRÓXIMOS PASSOS

1. **Publicar e testar:**
   - Seguir o manual em PDF
   - Executar os 10 testes da tabela de validação
   - Confirmar query SQL de verificação RLS

2. **Monitoramento contínuo:**
   - Configurar revisão semanal da aba Segurança
   - Baixar backup JSON mensalmente

3. **Otimização (se performance for prioridade):**
   - Implementar code-splitting para gráficos
   - Considerar lazy loading de outras abas

4. **Conformidade legal:**
   - Redigir termo de uso e política de privacidade
   - Incluir link no rodapé da aplicação

5. **Manutenção preventiva:**
   - `npm update` trimestral
   - Reexecutar teste de isolamento semestralmente
   - Rotação de `anon key` após 90 dias ou incidente

---

**FIM DO RELATÓRIO**

Revisão executada em: 05/08/2026  
Próxima revisão recomendada: 05/02/2027 (6 meses)
