# Guia de Implantação - Planejador Financeiro v2.0

**Versão Pós-Auditoria de Segurança**  
**Atualizado:** 5 de agosto de 2026

---

## 🎯 Pré-requisitos

- Conta no [Supabase](https://supabase.com) (gratuita ou paga)
- Conta no [Vercel](https://vercel.com) (gratuita ou paga)
- Node.js 18+ instalado localmente (opcional, para desenvolvimento)

---

## 📋 Passo a Passo Completo

### 1. Configurar o Supabase

#### 1.1 Criar o Projeto

1. Acesse [app.supabase.com](https://app.supabase.com)
2. Clique em **"New Project"**
3. Preencha:
   - **Name:** Planejador Financeiro
   - **Database Password:** Use um gerenciador de senhas para gerar uma senha forte
   - **Region:** Escolha a mais próxima dos seus usuários (ex: South America - São Paulo)
4. Clique em **"Create new project"**
5. Aguarde 2-3 minutos enquanto o banco é provisionado

#### 1.2 Executar o Schema de Segurança (CRÍTICO)

⚠️ **IMPORTANTE:** Esta versão inclui **5 correções críticas de segurança**. Use o schema atualizado.

1. No painel do Supabase, vá em **SQL Editor** (menu lateral esquerdo)
2. Clique em **"New query"**
3. Abra o arquivo `supabase/schema.sql` do repositório
4. **Copie TODO o conteúdo** (é um arquivo grande, ~800 linhas)
5. Cole no editor SQL
6. Clique em **"Run"** (canto inferior direito)
7. Aguarde a execução (pode levar 10-15 segundos)

✅ **Verificação obrigatória:** Execute esta query para confirmar:

```sql
SELECT tablename, rowsecurity as rls_ativa,
  (SELECT count(*) FROM pg_policies p 
   WHERE p.tablename = t.tablename) as politicas
FROM pg_tables t
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'categories', 'transactions', 'budgets', 'goals', 'security_events')
ORDER BY tablename;
```

**Resultado esperado:** Todas as 6 linhas com `rls_ativa = true` e `politicas > 0`

#### 1.3 Obter as Credenciais

1. No painel do Supabase, vá em **Settings** (ícone de engrenagem) → **API**
2. Anote os valores:
   - **Project URL** (formato: `https://xxxxxxxxxxxx.supabase.co`)
   - **anon public** key (uma string longa começando com `eyJ...`)

⚠️ **NUNCA pegue a `service_role` key**. Esta chave ignora todas as proteções de segurança e não deve ser usada no frontend.

---

### 2. Fazer Deploy no Vercel

#### 2.1 Conectar o Repositório

1. Acesse [vercel.com](https://vercel.com)
2. Faça login com sua conta GitHub
3. Clique em **"Add New..."** → **"Project"**
4. Importe o repositório `plan_financ_br`
5. Vercel detectará automaticamente que é um projeto Vite

#### 2.2 Configurar as Variáveis de Ambiente

**Antes de fazer o deploy**, clique em **"Environment Variables"** e adicione:

| Name | Value | Description |
|------|-------|-------------|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` | URL do seu projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` | `eyJhb...` | Sua anon/public key |

⚠️ **Atenção:** As variáveis começam com `VITE_` porque são embutidas no build do Vite e ficam visíveis no JavaScript do navegador. Isso é esperado e seguro — a proteção real vem das políticas RLS no banco.

#### 2.3 Deploy

1. Clique em **"Deploy"**
2. Aguarde 2-3 minutos
3. Vercel mostrará a URL do seu app (ex: `https://seu-app.vercel.app`)

---

### 3. Testar a Aplicação

#### 3.1 Criar a Primeira Conta

1. Acesse a URL do Vercel
2. Clique em **"Criar conta"**
3. Preencha:
   - **Nome completo**
   - **E-mail**
   - **Senha** (mínimo 8 caracteres)
4. Confirme o e-mail (Supabase envia automaticamente)

#### 3.2 Configurar MFA (Recomendado)

⚠️ **IMPORTANTE:** Com as novas correções de segurança, **MFA agora é obrigatório na camada de banco** para usuários que o configurarem.

1. No app, vá em **Segurança** → **Verificação em duas etapas**
2. Clique em **"Ativar"**
3. Escaneie o QR Code com:
   - Google Authenticator
   - Microsoft Authenticator
   - Authy
   - Ou outro app compatível com TOTP
4. Digite o código de 6 dígitos
5. Clique em **"Confirmar"**

✅ **Após ativar o MFA, o banco exigirá token AAL2 em todas as operações.** Tokens AAL1 (sem MFA) serão rejeitados automaticamente.

#### 3.3 Verificar Logs de Segurança

1. Vá em **Segurança** → **Histórico de eventos**
2. Você deve ver eventos como:
   - ✅ Conta criada
   - ✅ Login realizado
   - 🔐 Verificação em duas etapas ativada
   - 🔑 Código de verificação aceito

---

## 🔐 Checklist de Segurança Pós-Deploy

Execute este checklist **obrigatoriamente**:

### No Supabase

- [ ] RLS habilitada em todas as tabelas (verificação SQL acima)
- [ ] Schema v2.0 aplicado com as 5 correções de segurança
- [ ] MFA configurado na sua conta de administrador
- [ ] Service role key NUNCA exposta no frontend ou variáveis VITE_

### No Vercel

- [ ] Variáveis de ambiente configuradas (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY)
- [ ] Deploy bem-sucedido
- [ ] HTTPS ativo (Vercel faz isso automaticamente)

### Na Aplicação

- [ ] Login funcional
- [ ] MFA funcional (se configurado)
- [ ] Lançamentos criados apenas para o próprio usuário
- [ ] Logs de segurança registrados corretamente
- [ ] Importação de backup bloqueia objetos com `__proto__`

---

## 🛡️ Correções de Segurança Aplicadas (v2.0)

Esta versão corrige **5 vulnerabilidades críticas identificadas em auditoria profunda**:

### 1. Schema Shadowing (CRÍTICO)
- **Correção:** `search_path = public, pg_temp` em funções `SECURITY DEFINER`
- **Impacto:** Previne injeção de código SQL via schema malicioso

### 2. Bypass de MFA (CRÍTICO)
- **Correção:** Função `has_required_aal()` valida AAL2 para usuários com MFA
- **Impacto:** MFA agora é obrigatório **na camada de banco**, não só no frontend

### 3. DoS via Security Events (ALTO)
- **Correção:** Rate limiting de 50 eventos/hora por usuário
- **Impacto:** Protege contra spam de logs e esgotamento de armazenamento

### 4. JWT TOCTOU (CRÍTICO)
- **Correção:** Função `is_token_valid()` invalida tokens emitidos antes de troca de senha
- **Impacto:** Sessões revogadas são bloqueadas **imediatamente**, não após 1 hora

### 5. Prototype Pollution (ALTO)
- **Correção:** `sanitizeObject()` remove `__proto__`, `constructor` e `prototype` recursivamente
- **Impacto:** Previne execução de código via backup JSON malicioso

📄 **Documentação completa:** `docs/AUDITORIA-SEGURANCA-2.0.md`

---

## 🔄 Atualizando de v1.0 para v2.0

Se você já tem uma instalação rodando:

1. **Faça backup dos dados** via **Configurações** → **Exportar dados**
2. Execute o `schema.sql` completo v2.0 no SQL Editor
   - ⚠️ Não há risco de perda de dados — o schema é idempotente
   - Novas funções serão criadas, políticas RLS serão atualizadas
3. Faça novo deploy no Vercel (git push)
4. **Não é necessário reconfigurar MFA** — usuários com MFA já ativo terão AAL2 exigido automaticamente

### Atualizações futuras após a v2.0

Não reaplique automaticamente o `schema.sql` completo para cada funcionalidade.
Instalações existentes devem evoluir por migrações incrementais e versionadas em
`supabase/migrations/`, com banco compatível publicado antes do frontend que
depende da mudança.

Consulte o procedimento completo, incluindo ambientes de homologação, Preview
Deployments, backups, padrão expandir/contrair, verificações e rollback em:

**[`docs/ATUALIZACOES-E-DEPLOY.md`](./ATUALIZACOES-E-DEPLOY.md)**

---

## 🚨 O Que NUNCA Fazer

1. **NUNCA** exponha a `service_role_key` no código ou variáveis VITE_
2. **NUNCA** desabilite RLS em produção
3. **NUNCA** remova as validações `is_token_valid()` e `has_required_aal()` das políticas RLS
4. **NUNCA** use `SECURITY DEFINER` sem fixar o `search_path`
5. **NUNCA** registre senhas, códigos TOTP ou segredos nos logs
6. **NUNCA** confie em validação apenas no frontend

---

## 📞 Suporte e Troubleshooting

### Erro: "new row violates row-level security policy"

**Causa:** Token JWT sem AAL2 tentando acessar dados de usuário com MFA configurado.

**Solução:**
1. Faça logout completo
2. Faça login novamente
3. Se o MFA estiver ativo, digite o código de 6 dígitos
4. O novo token terá AAL2 e o acesso funcionará

### Erro: "Failed to fetch" ao fazer requisições

**Causa:** Variáveis de ambiente não configuradas ou URL incorreta.

**Solução:**
1. Verifique no Vercel: Settings → Environment Variables
2. Confirme que `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` estão corretas
3. Refaça o deploy após corrigir

### MFA não está funcionando

**Solução:**
1. Verifique se o relógio do dispositivo está sincronizado (TOTP depende de horário preciso)
2. Tente usar o código de backup (se configurado)
3. Se necessário, desative e reactive o MFA

### Importação de backup falha

**Causa:** Arquivo JSON muito grande ou formato inválido.

**Solução:**
1. Verifique se o arquivo tem menos de 8 MB
2. Confirme que é um backup exportado pelo próprio Planejador
3. Se o erro persistir, verifique o console do navegador para detalhes

---

## 📚 Referências

- [Documentação do Supabase](https://supabase.com/docs)
- [Row Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [Vercel Deploy](https://vercel.com/docs)
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)

---

**Deploy seguro e protegido com as últimas correções de segurança!** 🎉🔐
