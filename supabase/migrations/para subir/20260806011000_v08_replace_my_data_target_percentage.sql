-- migration: recria replace_my_data incluindo target_percentage nas categorias
--
-- OBJETIVO
--   A RPC transacional de importacao (V-05) inseria categorias sem a coluna
--   target_percentage (criada na v07). Esta versao passa a preencher a coluna,
--   mantendo o restante identico (delete + insert na mesma transacao).
--
-- PRE-CONDICOES
--   - Funcao public.replace_my_data(jsonb) ja existe (V-05).
--   - Coluna categories.target_percentage ja existe (v07). Aplicar v07 ANTES.
--
-- COMPATIBILIDADE
--   Retrocompativel. Mesma assinatura (jsonb) e mesmo grant. Se o payload nao
--   trouxer target_percentage, coalesce assume 0 (igual ao default da coluna).
--   CREATE OR REPLACE nao invalida grants existentes.
--
-- IMPACTO EM RLS/GRANTS/INDICES
--   Nenhuma mudanca de RLS. Mantem SECURITY DEFINER + search_path fixo e o
--   grant apenas para authenticated.
--
-- VERIFICACAO POSTERIOR
--   Importar um backup com categorias que tenham target_percentage e conferir
--   que o valor foi gravado; em erro de insert, os dados antigos permanecem.
--
-- RECUPERACAO
--   Reaplicar o corpo anterior (V-05) via nova migracao corretiva.

create or replace function public.replace_my_data(p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'nao autenticado';
  end if;

  -- tudo dentro da mesma transacao: erro = rollback automatico
  delete from public.transactions where user_id = v_uid;
  delete from public.budgets      where user_id = v_uid;
  delete from public.goals        where user_id = v_uid;
  delete from public.categories   where user_id = v_uid;

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
  select
    v_uid, x.category_id, x.limit_amount,
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(p_data->'budgets')
    as x(category_id text, limit_amount numeric, created_at timestamptz, updated_at timestamptz);

  insert into public.goals (
    user_id, id, name, target, current, deadline, icon, color, created_at, updated_at
  )
  select
    v_uid, x.id, x.name, x.target, x.current, x.deadline, x.icon, x.color,
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(p_data->'goals')
    as x(
      id text, name text, target numeric, current numeric, deadline date,
      icon text, color text, created_at timestamptz, updated_at timestamptz
    );
end;
$$;

grant execute on function public.replace_my_data(jsonb) to authenticated;
revoke execute on function public.replace_my_data(jsonb) from public, anon;
