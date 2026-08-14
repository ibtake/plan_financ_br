create or replace function public.replace_my_data(p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000';
  end if;

  delete from public.transactions where user_id = v_uid;
  delete from public.budgets where user_id = v_uid;
  delete from public.goals where user_id = v_uid;
  delete from public.categories where user_id = v_uid;

  insert into public.categories (user_id, id, name, icon, color, type, target_percentage)
  select v_uid, x.id, x.name, x.icon, x.color, x.type, coalesce(x.target_percentage, 0)
  from jsonb_to_recordset(p_data->'categories')
    as x(id text, name text, icon text, color text, type text, target_percentage numeric);

  insert into public.transactions (
    user_id, id, type, description, amount, category_id, date, method,
    paid, recurrence, recurrence_end, installments, tags, note,
    paid_occurrences, created_at, updated_at
  )
  select
    v_uid, x.id, x.type, x.description, x.amount, x.category_id, x.date, x.method,
    x.paid, x.recurrence, x.recurrence_end, x.installments, x.tags, x.note,
    x.paid_occurrences, coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(p_data->'transactions')
    as x(
      id text, type text, description text, amount numeric, category_id text,
      date date, method text, paid boolean, recurrence text, recurrence_end date,
      installments integer, tags text[], note text, paid_occurrences jsonb,
      created_at timestamptz, updated_at timestamptz
    );

  insert into public.budgets (user_id, category_id, limit_amount, created_at, updated_at)
  select v_uid, x.category_id, x.limit_amount,
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(p_data->'budgets')
    as x(category_id text, limit_amount numeric, created_at timestamptz, updated_at timestamptz);

  insert into public.goals (
    user_id, id, name, target, current, deadline, icon, color, created_at, updated_at
  )
  select v_uid, x.id, x.name, x.target, x.current, x.deadline, x.icon, x.color,
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(p_data->'goals')
    as x(
      id text, name text, target numeric, current numeric, deadline date,
      icon text, color text, created_at timestamptz, updated_at timestamptz
    );
end;
$$;

revoke execute on function public.replace_my_data(jsonb) from public, anon;
grant execute on function public.replace_my_data(jsonb) to authenticated;

create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000';
  end if;

  delete from public.transactions where user_id = v_uid;
  delete from public.budgets      where user_id = v_uid;
  delete from public.goals        where user_id = v_uid;
  delete from public.categories   where user_id = v_uid;

  insert into public.security_events (user_id, event_type, severity, details)
  values (v_uid, 'bulk_delete', 'warning',
          jsonb_build_object('scope', 'all_financial_data'));
end;
$$;

revoke all on function public.delete_my_data() from public;
revoke all on function public.delete_my_data() from anon;
grant execute on function public.delete_my_data() to authenticated;