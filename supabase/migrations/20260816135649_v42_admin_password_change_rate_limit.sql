-- =====================================================================
-- migration: v42 - rate limit server-side de complete-password-change
-- =====================================================================
--
-- OBJETIVO
--   Cobrir a unicaacao mutante do admin-users que estava fora do
--   consume_admin_rate_limit: a troca inicial de senha obrigatoria
--   (usuarios criados pelo administrador com must_change_password).
--   Sem esse limite, um portador de sessao AAL1 podia tentar senhas sem
--   teto server-side (a politica de força e validada, mas nao a frequencia).
--
-- PRE-CONDICOES
--   - RPC consume_admin_rate_limit existente (limite por janela de 1 min).
--
-- COMPATIBILIDADE
--   - Somente aditiva: constraint ampliada e RPC redefinida incluindo a
--     nova acao com limite generoso (10/min) - acima do uso legitimo,
--     pois a troca ocorre uma unica vez no primeiro login de cada conta.
--   - A Edge Function admin-users anterior continua funcionando: ela
--     nao chama a RPC para complete-password-change e a constraint aceita
--     todos os valores antigos.
--   - Deploy em ordem: aplicar esta migration ANTES da nova admin-users.
--
-- IMPACTO
--   - RLS/grants inalterados (tabela e RPC seguem inacessiveis a
--     public/anon/authenticated; execucao somente service_role).
--   - A constraint action e recriada incluindo 'complete-password-change'.
--   - Nenhum dado existente e alterado ou removido.
--
-- VERIFICACAO POSTERIOR
--   - Chamar complete-password-change 11 vezes em homologacao com um
--     usuario de teste: a 11a deve retornar 429 com Retry-After.
--   - Fluxo legitimo (primeiro login + troca de senha) deve completar.
--
-- RECUPERACAO
--   Migration corretiva posterior restringindo a lista e o case ao estado
--   anterior; nenhuma etapa destrutiva.
-- =====================================================================

begin;

alter table public.admin_action_rate_limits
  drop constraint admin_action_rate_limits_action_check;

alter table public.admin_action_rate_limits
  add constraint admin_action_rate_limits_action_check
  check (action in ('status', 'list-users', 'create-user', 'widget-metrics', 'complete-password-change'));

create or replace function public.consume_admin_rate_limit(p_admin_id uuid, p_action text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer; v_started timestamptz; v_limit integer;
begin
  if p_action not in ('status', 'list-users', 'create-user', 'widget-metrics', 'complete-password-change') then raise exception 'acao invalida'; end if;
  v_limit := case p_action when 'create-user' then 5 when 'list-users' then 30 when 'widget-metrics' then 30 when 'complete-password-change' then 10 else 60 end;
  insert into public.admin_action_rate_limits(admin_id, action, window_started_at, request_count)
  values (p_admin_id, p_action, now(), 1)
  on conflict (admin_id, action) do update set
    window_started_at = case when public.admin_action_rate_limits.window_started_at < now() - interval '1 minute' then now() else public.admin_action_rate_limits.window_started_at end,
    request_count = case when public.admin_action_rate_limits.window_started_at < now() - interval '1 minute' then 1 else public.admin_action_rate_limits.request_count + 1 end
  returning request_count, window_started_at into v_count, v_started;
  return v_count <= v_limit;
end; $$;

revoke all on function public.consume_admin_rate_limit(uuid,text) from public,anon,authenticated;
grant execute on function public.consume_admin_rate_limit(uuid,text) to service_role;

commit;
