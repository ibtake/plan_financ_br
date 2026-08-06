begin;

alter table public.categories
  add column if not exists target_percentage numeric not null default 0;

alter table public.categories
  drop constraint if exists categories_target_percentage_check;
alter table public.categories
  add constraint categories_target_percentage_check
  check (target_percentage >= 0 and target_percentage <= 100);

commit;