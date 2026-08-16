-- =====================================================================
-- migration: v41 - SEC-02 least privilege em public.goals + PUBLIC em defaults
-- =====================================================================
--
-- OBJETIVO
--   1. Fechar o bypass Medium do pentest: metas reversas guardam os campos
--      sensiveis (reverse_original_amount, reverse_completed_at, goal_type,
--      etc.) em public.goals, que mantinha grants amplos de DML para
--      authenticated - inclusive TRUNCATE, TRIGGER e REFERENCES residuais
--      de migrations antigas nao registrados no schema.sql consolidado.
--      Escrever direto na tabela contornava toda a validacao das RPCs.
--   2. Fechar o furo "Info": o EXECUTE implicito de PUBLIC em funcoes
--      futuras nao era revogado pela V38 (faltava "public" na lista).
--   3. Alinhar o revoke do create_reverse_goal com o schema.sql consolidado.
--
-- PRE-CONDICOES
--   - V38 e V39 aplicadas (confirmadas em banco: constraints
--     goals_reverse_*_limit presentes; anon sem EXECUTE em
--     rebuild_reverse_goal(text)).
--
-- COMPATIBILIDADE
--   - Frontend atual (v1.5.x) e onboarding NAO usam escrita direta em
--     goals: criacao/exclusao/aportes passam por RPCs
--     (create_standard_goal, create_reverse_goal, delete_goal,
--     replace_my_data) e o unico update direto escreve apenas
--     name/icon/color (useSupabaseFinance.js).
--   - ATT compatibilidade com abas antigas: frontends <= v1.3.x
--     faziam insert/update/delete diretos em goals; apos esta migration,
--     essas operacoes retornam "Acesso negado..." ate o usuario
--     recarregar a aba (F5) na versao nova. Erro e nao corrompimento.
--   - RPCs SECURITY DEFINER (owner postgres) e service_role nao dependem
--     do grant de authenticated; Edge Functions nao sao afetadas.
--
-- IMPACTO
--   - RLS permanece habilitado e forcado; politicas inalteradas.
--   - Grants de authenticated em goals passam a ser:
--       SELECT (linha inteira) + UPDATE apenas em (name, icon, color).
--   - Remove INSERT, DELETE, TRUNCATE, TRIGGER e REFERENCES de
--     authenticated em goals.
--   - Default privileges de funcoes futuras do papel postgres passam a
--     revogar tambem de PUBLIC (EXECUTE implicito).
--
-- VERIFICACAO POSTERIOR
--   1. Grants em goals: consultar information_schema.role_table_grants e
--      role_column_grants para table_name='goals'; authenticated deve
--      aparecer apenas em SELECT e UPDATE(name, icon, color).
--   2. EXECUTE implicito de PUBLIC: criar uma funcao temporaria de teste
--      no schema public e conferir, via has_function_privilege, que anon
--      retorna false para EXECUTE nela; remover a funcao em seguida.
--
-- RECUPERACAO
--   Migration corretiva posterior re-grantando conforme necessario
--   (ex.: grant insert/delete se um fluxo legitimo for identificado em
--   homologacao). Nenhum dado e alterado ou removido.
-- =====================================================================

begin;

-- 1. Least privilege em public.goals: leitura livre das proprias linhas
--    (RLS continua filtrando por dono), escrita apenas em metadados.
revoke all on table public.goals from authenticated;
grant select on table public.goals to authenticated;
grant update (name, icon, color) on table public.goals to authenticated;

-- 2. Funcoes futuras criadas pelo papel postgres nao devem herdar o
--    EXECUTE implicito de PUBLIC (a V38 revogava so de anon/authenticated,
--    o que nao remove o acesso herdado de PUBLIC).
alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

-- 3. Estado de privilegios do create_reverse_goal identico ao
--    schema.sql consolidado (a V39 revogava apenas de public, anon).
revoke all on function public.create_reverse_goal(text,numeric,numeric,date,numeric,text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_reverse_goal(text,numeric,numeric,date,numeric,text,text)
  to authenticated;

commit;