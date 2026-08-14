begin;

alter table public.categories
  drop constraint if exists categories_type_check;
alter table public.categories
  add constraint categories_type_check
  check (type in ('income', 'expense', 'reinvested'));

alter table public.transactions
  drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check
  check (type in ('income', 'expense', 'reinvested'));

commit;