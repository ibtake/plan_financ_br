-- migration: persiste os planos anuais do Aporte Certo por usuario
create table if not exists public.pgbl_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null check (year between 2000 and 2200),
  months jsonb not null default '[]'::jsonb,
  premise jsonb not null default '{}'::jsonb,
  fiscal_params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, year)
);

create index if not exists pgbl_plans_user_year_idx
  on public.pgbl_plans (user_id, year desc);

alter table public.pgbl_plans enable row level security;
alter table public.pgbl_plans force row level security;

drop policy if exists "own pgbl plans select" on public.pgbl_plans;
create policy "own pgbl plans select"
  on public.pgbl_plans for select
  using (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());

drop policy if exists "own pgbl plans insert" on public.pgbl_plans;
create policy "own pgbl plans insert"
  on public.pgbl_plans for insert
  with check (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());

drop policy if exists "own pgbl plans update" on public.pgbl_plans;
create policy "own pgbl plans update"
  on public.pgbl_plans for update
  using (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal())
  with check (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());

drop policy if exists "own pgbl plans delete" on public.pgbl_plans;
create policy "own pgbl plans delete"
  on public.pgbl_plans for delete
  using (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());

drop trigger if exists pgbl_plans_updated_at on public.pgbl_plans;
create trigger pgbl_plans_updated_at
  before update on public.pgbl_plans
  for each row execute function public.set_updated_at();

drop trigger if exists pgbl_plans_no_owner_change on public.pgbl_plans;
create trigger pgbl_plans_no_owner_change
  before update on public.pgbl_plans
  for each row execute function public.prevent_owner_change();

grant select, insert, update, delete on public.pgbl_plans to authenticated;