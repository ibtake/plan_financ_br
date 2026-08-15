-- migration: métricas agregadas e amostradas de falhas de autenticação do widget
create table if not exists public.widget_auth_metrics (
  metric_date date not null default current_date,
  failure_type text not null check (failure_type in ('token', 'refresh', 'install_code', 'unauthorized')),
  sampled_count integer not null default 0 check (sampled_count >= 0),
  last_sampled_at timestamptz not null default now(),
  primary key (metric_date, failure_type)
);

alter table public.widget_auth_metrics enable row level security;
alter table public.widget_auth_metrics force row level security;
revoke all on table public.widget_auth_metrics from public, anon, authenticated;

create or replace function public.record_widget_auth_metric(p_failure_type text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_failure_type not in ('token', 'refresh', 'install_code', 'unauthorized') then return; end if;
  insert into public.widget_auth_metrics (metric_date, failure_type, sampled_count)
  values (current_date, p_failure_type, 1)
  on conflict (metric_date, failure_type) do update
    set sampled_count = least(public.widget_auth_metrics.sampled_count + 1, 1000000000), last_sampled_at = now();
end; $$;

revoke all on function public.record_widget_auth_metric(text) from public, anon, authenticated;
grant execute on function public.record_widget_auth_metric(text) to service_role;
