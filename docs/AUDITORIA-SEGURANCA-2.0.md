# Auditoria de Segurança - Planejador Financeiro

**Última atualização:** 5 de agosto de 2026  
**Versão:** 2.0 (Pós-auditoria crítica)

---

## 🎯 Resumo Executivo

Esta aplicação passou por uma **auditoria profunda de segurança** conduzida por especialistas em DevSecOps e Supabase. Foram identificadas e **corrigidas 5 vulnerabilidades arquiteturais críticas** que poderiam comprometer a segurança dos dados financeiros dos usuários.

**Status atual:** ✅ **TODAS AS VULNERABILIDADES CORRIGIDAS**

---

## 🔐 Vulnerabilidades Corrigidas

### 1. Schema Shadowing em SECURITY DEFINER (CRÍTICO)

**Problema identificado:**
- A função `log_security_event()` usava `SECURITY DEFINER` sem definir explicitamente o `search_path`
- Atacante poderia criar um schema malicioso e sequestrar a execução da função

**Correção aplicada:**
```sql
CREATE OR REPLACE FUNCTION public.log_security_event(...)
SECURITY DEFINER
SET search_path = public, pg_temp  -- ← CORREÇÃO APLICADA
```

**Impacto:** Previne injeção de código via schema shadowing.

---

### 2. Bypass de MFA na Camada de Banco (CRÍTICO)

**Problema identificado:**
- MFA validado apenas no frontend
- Atacante com token AAL1 via API podia acessar dados ignorando o MFA

**Correção aplicada:**
- Nova função `has_required_aal()` valida o Assurance Level do JWT
- Todas as políticas RLS das tabelas críticas agora verificam:
  - Se o usuário tem MFA configurado → **exige token AAL2**
  - Se não tem MFA → aceita AAL1

```sql
CREATE POLICY "own transactions select"
  ON transactions FOR SELECT
  USING (
    auth.uid() = user_id 
    AND is_token_valid() 
    AND has_required_aal()  -- ← NOVA VERIFICAÇÃO
  );
```

**Tabelas protegidas:**
- `transactions` (lançamentos)
- `budgets` (orçamentos)
- `goals` (metas)
- `categories` (categorias)
- `profiles` (perfis)

**Impacto:** MFA agora é obrigatório em **toda a stack** (frontend + banco).

---

### 3. Negação de Serviço (DoS) via Security Events (ALTO)

**Problema identificado:**
- Tabela `security_events` permitia INSERT ilimitado via RLS
- Atacante podia esgotar o armazenamento do banco

**Correção aplicada:**
1. **Removida a política de INSERT direto** na tabela
2. **Rate limiting implementado** dentro da função RPC:
   - Máximo de **50 eventos por hora** por usuário
   - Tentativas acima do limite são silenciosamente descartadas

```sql
-- Dentro de log_security_event():
SELECT count(*) INTO v_event_count
FROM security_events
WHERE user_id = v_uid
  AND created_at > now() - interval '1 hour';

IF v_event_count >= 50 THEN
  RETURN;  -- Aborta inserção
END IF;
```

**Impacto:** Protege contra spam de eventos e database bloat.

---

### 4. JWT Time-of-Check-Time-of-Use (TOCTOU) (CRÍTICO)

**Problema identificado:**
- Após troca de senha, tokens JWT antigos continuavam válidos por até 1 hora
- Conta comprometida permanecia acessível mesmo após recuperação

**Correção aplicada:**
- Nova função `is_token_valid()` compara:
  - `iat` (issued_at) do JWT
  - `updated_at` do usuário em `auth.users`
- Token é **rejeitado** se foi emitido **antes** da última alteração de credenciais
- Implementado em **todas as políticas RLS**

```sql
CREATE POLICY "own transactions select"
  ON transactions FOR SELECT
  USING (
    auth.uid() = user_id 
    AND is_token_valid()  -- ← NOVA VERIFICAÇÃO
    AND has_required_aal()
  );
```

**Tolerância de 10 segundos:** Evita falsos positivos causados por:
- Granularidade de 1 segundo do `iat` vs. microssegundos do `updated_at`
- Supabase atualizar `last_sign_in_at` no momento do login

**Impacto:** Sessões revogadas são invalidadas **imediatamente**, não após 1 hora.

---

### 5. Prototype Pollution no Frontend (ALTO)

**Problema identificado:**
- Importação de backup JSON não sanitizava objetos forjados
- Atacante podia injetar `__proto__`, `constructor` ou `prototype`

**Correção aplicada:**
- Nova função `sanitizeObject()` percorre recursivamente o JSON
- Remove **todas as chaves perigosas** antes de qualquer uso:

```javascript
function sanitizeObject(obj) {
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeObject(item))
  }
  
  const sanitized = {}
  for (const key of Object.keys(obj)) {
    const lowerKey = key.toLowerCase()
    // Bloqueia as 3 chaves de ataque
    if (lowerKey === '__proto__' || 
        lowerKey === 'constructor' || 
        lowerKey === 'prototype') {
      continue  // Descarta silenciosamente
    }
    sanitized[key] = sanitizeObject(obj[key])
  }
  return sanitized
}
```

**Aplicado em:** `src/utils/exporters.js` → função `importJSON()`

**Impacto:** Previne poluição do prototype e execução de código via backup malicioso.

---

## 📊 Matriz de Impacto

| Vulnerabilidade | Severidade | Vetor de Ataque | Status |
|----------------|------------|-----------------|--------|
| Schema Shadowing | 🔴 Crítico | Injeção de código SQL | ✅ Corrigido |
| Bypass de MFA | 🔴 Crítico | API com token AAL1 | ✅ Corrigido |
| DoS via Events | 🟠 Alto | Spam de eventos | ✅ Corrigido |
| JWT TOCTOU | 🔴 Crítico | Reutilização de sessão | ✅ Corrigido |
| Prototype Pollution | 🟠 Alto | Backup JSON forjado | ✅ Corrigido |

---

## 🛡️ Camadas de Defesa Implementadas

### Defesa em Profundidade (Defense in Depth)

1. **Camada de Banco de Dados**
   - ✅ Row Level Security (RLS) em todas as tabelas
   - ✅ Validação de AAL2 para usuários com MFA
   - ✅ Validação de token JWT contra revogação
   - ✅ Rate limiting em eventos de segurança
   - ✅ `search_path` fixado em funções `SECURITY DEFINER`

2. **Camada de Aplicação**
   - ✅ Sanitização de JSON importado (prototype pollution)
   - ✅ Validação de MFA no frontend (primeira barreira)
   - ✅ Auditoria de tentativas de acesso indevido

3. **Camada de Rede**
   - ✅ HTTPS obrigatório (via Vercel/Supabase)
   - ✅ CORS configurado corretamente

---

## 🔄 Processo de Atualização

### Para usuários existentes:

1. **Faça backup dos dados** antes de atualizar o schema
2. Execute o novo `supabase/schema.sql` **completo** no SQL Editor do Supabase
3. **Não é necessário reconfigurar MFA** — usuários com MFA já configurado terão AAL2 exigido automaticamente
4. Faça deploy da nova versão do frontend

### Verificação pós-deploy:

Execute no SQL Editor do Supabase:
```sql
-- Todas as linhas devem ter rls_ativa = true
SELECT tablename, rowsecurity as rls_ativa,
  (SELECT count(*) FROM pg_policies p 
   WHERE p.tablename = t.tablename) as politicas
FROM pg_tables t
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'categories', 'transactions', 'budgets', 'goals', 'security_events')
ORDER BY tablename;
```

Resultado esperado: **todas as tabelas com `rls_ativa = true`**

---

## 📋 Checklist de Segurança (Atualizado)

### ✅ Implementado

- [x] RLS habilitada e forçada em todas as tabelas
- [x] Políticas RLS validam `user_id`, AAL e validade do token
- [x] MFA obrigatório na camada de banco para usuários com MFA configurado
- [x] Tokens revogados invalidados imediatamente (TOCTOU mitigado)
- [x] Rate limiting em eventos de segurança (50/hora)
- [x] `search_path` fixado em funções `SECURITY DEFINER`
- [x] Sanitização contra prototype pollution no frontend
- [x] Triggers impedem alteração de `user_id`
- [x] Constraints de banco validam formato e limites
- [x] Auditoria de tentativas de acesso indevido
- [x] Logs imutáveis (sem UPDATE/DELETE)
- [x] Chaves públicas (anon key) expostas no frontend
- [x] Service role key NUNCA usada no frontend

### 🔄 Manutenção Contínua

- [ ] Monitorar logs de `security_events` regularmente
- [ ] Revisar políticas RLS a cada nova tabela
- [ ] Atualizar dependências (React, Supabase SDK)
- [ ] Testar backup/restore periodicamente
- [ ] Revisar permissões de usuários no Supabase

---

## 🚨 O Que NUNCA Fazer

1. **NUNCA** exponha a `service_role_key` no frontend
2. **NUNCA** desabilite RLS em produção
3. **NUNCA** confie em validação apenas no frontend
4. **NUNCA** registre senhas, códigos TOTP ou segredos nos logs
5. **NUNCA** remova as validações `is_token_valid()` e `has_required_aal()` das políticas RLS
6. **NUNCA** use `SECURITY DEFINER` sem fixar o `search_path`

---

## 📞 Contato e Suporte

Para reportar vulnerabilidades de segurança:
- **NÃO** abra issues públicas no GitHub
- Entre em contato diretamente via e-mail privado

---

## 📚 Referências

- [Supabase Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL SECURITY DEFINER Best Practices](https://www.postgresql.org/docs/current/sql-createfunction.html)
- [OWASP Prototype Pollution](https://cheatsheetseries.owasp.org/cheatsheets/Prototype_Pollution_Prevention_Cheat_Sheet.html)
- [JWT Security Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)

---

**Documento gerado após auditoria de segurança profunda**  
**Todas as vulnerabilidades identificadas foram corrigidas**
