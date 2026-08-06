# Supabase - atualização V1.1.1

Esta versão requer a migração `20260806143000_add_admin_action_rate_limit.sql`.
Ela cria uma tabela interna de contagem e uma função acessível somente ao papel
`service_role`, usada pela Edge Function `admin-users`. Não altera dados
financeiros, RLS das tabelas existentes ou permissões de usuários finais.

1. Confirme backup/PITR e abra o projeto de **homologação** no SQL Editor.
2. Copie e execute integralmente a migração nova. Não execute `schema.sql` em
   instalação existente e não altere migrações anteriores.
3. Verifique:

```sql
select to_regclass('public.admin_action_rate_limits');
select routine_name from information_schema.routines
where routine_schema = 'public' and routine_name = 'consume_admin_rate_limit';
```

4. Publique a Edge Function `admin-users` no ambiente de homologação pelo
   fluxo autorizado da equipe e teste: até 5 criações por administrador/minuto
   e 30 listagens/minuto; a chamada seguinte deve receber HTTP 429.
5. Faça o Preview da Vercel apontando para homologação e teste login, MFA,
   administração de usuários e notificações.
6. Repita a migração no Supabase de produção, confirme as consultas e só então
   publique o frontend/Edge Function de produção.

Rollback: para falha de frontend, promova deployment estável anterior. Para
banco, mantenha a tabela e crie nova migração corretiva; não apague contadores
ou estrutura automaticamente.
