begin;

alter table public.profiles
  add column if not exists transaction_form_fields jsonb not null
    default '{"method": true, "recurrence": true, "installments": true, "tags": true, "note": true, "paid": true}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_transaction_form_fields_check;

alter table public.profiles
  add constraint profiles_transaction_form_fields_check
  check (jsonb_typeof(transaction_form_fields) = 'object');

commit;
