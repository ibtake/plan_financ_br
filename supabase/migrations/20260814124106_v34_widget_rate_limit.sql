begin;

create table if not exists public.widget_rate_limits (
  key_hash text not null,
  operation text not null check (operation in ('token', 'refresh', 'install')),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (key_hash, operation)
);

alter table public.widget_rate_limits enable row level security;
alter table public.widget_rate_limits force row level security;

create or replace function public.consume_widget_rate_limit(
  p_key_hash text,
  p_operation text
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_started timestamptz;
  v_limit integer;
  v_window_seconds integer := 60;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'chave de rate limit invalida';
  end if;
  if p_operation not in ('token', 'refresh', 'install') then
    raise exception 'operacao de rate limit invalida';
  end if;

  v_limit := case p_operation when 'token' then 60 when 'refresh' then 10 else 5 end;

  insert into public.widget_rate_limits(key_hash, operation, window_started_at, request_count)
  values (p_key_hash, p_operation, now(), 1)
  on conflict (key_hash, operation) do update set
    window_started_at = case when public.widget_rate_limits.window_started_at < now() - make_interval(secs => v_window_seconds) then now() else public.widget_rate_limits.window_started_at end,
    request_count = case when public.widget_rate_limits.window_started_at < now() - make_interval(secs => v_window_seconds) then 1 else public.widget_rate_limits.request_count + 1 end
  returning request_count, window_started_at into v_count, v_started;

  return query select
    v_count <= v_limit,
    greatest(0, ceil(extract(epoch from (v_started + make_interval(secs => v_window_seconds) - now())))::integer);
end;
$$;

revoke all on table public.widget_rate_limits from public, anon, authenticated;
revoke all on function public.consume_widget_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.consume_widget_rate_limit(text, text) to service_role;

commit;