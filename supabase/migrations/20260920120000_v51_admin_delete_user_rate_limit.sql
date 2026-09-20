-- =====================================================================
-- migration: v51 - TASK-013: teto administrativo para delete-user
-- =====================================================================
--
-- OBJETIVO
--   A funcao admin-users ganha a acao `delete-user` (exclusao completa
--   de uma conta pelo administrador). Como as demais acoes mutantes, ela
--   passa pelo teto server-side `consume_admin_rate_limit`. Esta migration
--   registra `delete-user` no check da tabela `admin_action_rate_limits`
--   e no `case` da RPC, com teto 3/min: exclusao de conta e rara e
--   destrutiva, o teto apertado e defesa em profundidade contra abuso de
--   uma sessao administrativa comprometida.
--
-- PRE-CONDICOES
--   - Tabela `admin_action_rate_limits` e RPC `consume_admin_rate_limit`
--     existentes (BLOCO 24, v11/v19/v20/v42).
--
-- COMPATIBILIDADE
--   - Amplia o check e o `case` sem remover valores existentes: acoes
--     anteriores mantem os mesmos limites. A Edge Function anterior a este
--     deploy nunca envia `delete-user`, entao nao ha janela de quebra.
--   - Sem mudanca de assinatura: a RPC continua `(uuid, text) -> boolean`.
--
-- IMPACTO
--   - RLS/grants inalterados: execucao somente para service_role.
--   - Uma linha por (admin, 'delete-user') na janela de 1 minuto, como as
--     demais acoes; sem novo armazenamento relevante.
--
-- VERIFICACAO POSTERIOR
--   select public.consume_admin_rate_limit('<admin-uuid>'::uuid, 'delete-user');  -- allowed = true nas 3 primeiras
--
-- RECUPERACAO
--   Migration corretiva pode restaurar o check e o `case` da v42 (sem
--   `delete-user`). Nenhuma etapa e destrutiva de dados de usuario.
-- =====================================================================

begin;

alter table public.admin_action_rate_limits drop constraint if exists admin_action_rate_limits_action_check;
alter table public.admin_action_rate_limits add constraint admin_action_rate_limits_action_check
  check (action in ('status', 'list-users', 'create-user', 'widget-metrics', 'complete-password-change', 'delete-user'));

create or replace function public.consume_admin_rate_limit(p_admin_id uuid, p_action text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer; v_started timestamptz; v_limit integer;
begin
  if p_action not in ('status', 'list-users', 'create-user', 'widget-metrics', 'complete-password-change', 'delete-user') then raise exception 'acao invalida'; end if;
  v_limit := case p_action when 'create-user' then 5 when 'list-users' then 30 when 'widget-metrics' then 30 when 'complete-password-change' then 10 when 'delete-user' then 3 else 60 end;
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
