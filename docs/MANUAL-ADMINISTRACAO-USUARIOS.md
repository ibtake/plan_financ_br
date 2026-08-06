# Manual de administração de usuários

## 1. Modelo de segurança

- Não existe cadastro público na interface.
- Em **Supabase > Authentication > Providers > Email**, mantenha **Allow new users to sign up** desativado. O `supabase/config.toml` documenta a mesma regra para ambientes gerenciados pela CLI.
- A função `admin-users` usa `service_role` somente no servidor Supabase. Essa chave nunca deve ser copiada para Vercel, GitHub, `.env` do frontend ou variável `VITE_*`.
- O administrador é identificado pelo UUID imutável do Auth, não por e-mail.
- A área administrativa só lista usuários com sessão MFA AAL2. Criar uma conta exige nova confirmação TOTP e a autorização expira após cinco minutos.
- O usuário recebe senha temporária e é impedido de acessar o produto até definir uma senha própria.

## 2. Preparação no Supabase

1. Abra **Authentication > Users**, localize sua conta administrativa e copie o **User UID**.
2. Ative MFA/TOTP nessa conta pela aba **Segurança** do aplicativo. Saia e entre novamente confirmando o código.
3. Desative o cadastro público em **Authentication > Providers > Email**.
4. Em **Edge Functions > Secrets**, cadastre:
   - `APP_ADMIN_USER_IDS`: seu UUID; para mais de um administrador, use UUIDs separados por vírgula.
   - `APP_ALLOWED_ORIGINS`: URL exata de produção e, se necessário, URLs de homologação separadas por vírgula. Não use `*`.
5. Não crie `SUPABASE_SERVICE_ROLE_KEY` manualmente no frontend. O ambiente das Edge Functions fornece os secrets internos do projeto.
6. Publique a função:

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase functions deploy admin-users
```

Confirme o projeto de destino antes dos comandos. Teste primeiro em homologação.

## 3. Variáveis da Vercel

Na Vercel, o frontend continua usando somente:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Nunca coloque `service_role`, `APP_ADMIN_USER_IDS` ou senhas na Vercel. Após conferir as variáveis, faça Preview Deployment, valide e só então promova para Production.

## 4. Criar um usuário

1. Entre com a conta administrativa e confirme o MFA.
2. Abra **Configurações > Administração de usuários**.
3. Informe nome e e-mail.
4. Clique **Gerar** para criar uma senha temporária forte.
5. Informe o código atual do aplicativo autenticador e clique **Criar usuário**.
6. Entregue e-mail e senha temporária em canais separados e seguros. Não envie a senha em grupo, ticket público ou commit.
7. No primeiro login, o usuário obrigatoriamente define uma senha própria antes de visualizar qualquer dado financeiro.

## 5. Checklist de validação

- Visitante não encontra opção de cadastro.
- Tentativa direta de `signUp` é recusada pelo Supabase.
- Usuário comum não vê a área administrativa e recebe 403 se chamar a função.
- Administrador sem MFA não lista nem cria usuários.
- Administrador com MFA lista usuários e cria uma conta.
- E-mail duplicado retorna mensagem neutra.
- Conta nova é bloqueada na troca inicial de senha.
- Depois da troca, a conta acessa apenas os próprios dados por RLS.
- Login, leitura, criação, edição e exclusão financeira continuam funcionando.

## 6. Publicação e rollback

Ordem: (1) secrets e cadastro público desativado no Supabase; (2) Edge Function; (3) Preview Vercel; (4) testes; (5) produção. Não há migração de banco nesta funcionalidade e nenhum dado existente é alterado.

Para rollback do frontend, promova o deployment estável anterior na Vercel. Para a função, publique novamente a versão estável anterior. Manter o cadastro público desativado é seguro durante o rollback; usuários existentes continuam entrando normalmente. Não exclua usuários nem dados como forma de rollback.