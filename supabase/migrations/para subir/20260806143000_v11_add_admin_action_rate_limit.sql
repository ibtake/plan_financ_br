-- migration: rate limit persistente para a Edge Function admin-users
-- Pre-condicoes: tabelas public e papel service_role existentes no Supabase.
-- Compatibilidade: nao altera dados financeiros, RLS ou chamadas antigas.
-- Recuperacao: nova migracao pode ajustar limites ou desativar a chamada na Edge Function.

begin;

create table if not exists public.admin_action_rate_limits (
  admin_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('status', 'list-users', 'create-user')),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (admin_id, action)
);

alter table public.admin_action_rate_limits enable row level security;
alter table public.admin_action_rate_limits force row level security;

create or replace function public.consume_admin_rate_limit(p_admin_id uuid, p_action text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer; v_started timestamptz; v_limit integer;
begin
  if p_action not in ('status', 'list-users', 'create-user') then raise exception 'acao invalida'; end if;
  v_limit := case p_action when 'create-user' then 5 when 'list-users' then 30 else 60 end;
  insert into public.admin_action_rate_limits(admin_id, action, window_started_at, request_count)
  values (p_admin_id, p_action, now(), 1)
  on conflict (admin_id, action) do update set
    window_started_at = case when public.admin_action_rate_limits.window_started_at < now() - interval '1 minute' then now() else public.admin_action_rate_limits.window_started_at end,
    request_count = case when public.admin_action_rate_limits.window_started_at < now() - interval '1 minute' then 1 else public.admin_action_rate_limits.request_count + 1 end
  returning request_count, window_started_at into v_count, v_started;
  return v_count <= v_limit;
end; $$;

revoke all on table public.admin_action_rate_limits from public, anon, authenticated;
revoke all on function public.consume_admin_rate_limit(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_admin_rate_limit(uuid, text) to service_role;

commit;
