begin;

-- =====================================================================
-- v47 - Reserva de emergência (IMPR-004)
-- =====================================================================
-- Persistência mínima da Reserva de emergência: uma linha por usuário com
-- a meta de meses e a base de correção manual. O SALDO não é guardado — é
-- derivado no app (baseline_amount + lançamentos da categoria
-- 'reserva-emergencia' posteriores a baseline_date). Escrita apenas por RPC
-- security definer (mesmo desenho de reverse_goal_retention_settings): o
-- cliente recebe só SELECT sob RLS.
--
-- Nova categoria padrão 'reserva-emergencia' do tipo reinvested: sai da
-- liquidez sem ser consumo (acumula patrimônio) e, por não ser 'expense',
-- fica naturalmente fora da média de despesas do burn-rate.
--
-- Backup/restore da meta/base fica fora do escopo do IMPR-004 (exigiria a
-- cadeia de export em src/); replace_my_data apaga a linha para não sobrar
-- base velha após um restore, sem reimportá-la.
-- =====================================================================

-- 1. Tabela + RLS + policy + grants (SELECT ao cliente; escrita via RPC)
create table if not exists public.emergency_reserve (
  user_id uuid primary key references auth.users(id) on delete cascade,
  target_months smallint check (target_months between 1 and 60),
  baseline_amount numeric(14,2) not null default 0 check (baseline_amount >= 0),
  baseline_date date,
  updated_at timestamptz not null default now()
);
alter table public.emergency_reserve enable row level security;
alter table public.emergency_reserve force row level security;
create policy "own emergency reserve select" on public.emergency_reserve for select to authenticated using (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());
revoke all on table public.emergency_reserve from anon;
revoke all on table public.emergency_reserve from authenticated;
grant select on table public.emergency_reserve to authenticated;

-- 2. RPCs de escrita (upsert por coluna: setar meta não apaga a base e vice-versa)
create or replace function public.set_emergency_reserve_target(p_months smallint default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000'; end if;
  if p_months is not null and p_months not between 1 and 60 then raise exception 'meta de meses invalida' using errcode = '22023'; end if;
  insert into public.emergency_reserve(user_id, target_months, updated_at) values (v_uid, p_months, now())
  on conflict (user_id) do update set target_months = excluded.target_months, updated_at = now();
end; $$;

create or replace function public.set_emergency_reserve_baseline(p_amount numeric, p_date date default current_date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000'; end if;
  if p_amount is null or p_amount < 0 or p_amount >= 1000000000 then raise exception 'valor de reserva invalido' using errcode = '22023'; end if;
  if p_date is null or p_date > current_date then raise exception 'data de correcao invalida' using errcode = '22023'; end if;
  insert into public.emergency_reserve(user_id, baseline_amount, baseline_date, updated_at) values (v_uid, round(p_amount, 2), p_date, now())
  on conflict (user_id) do update set baseline_amount = excluded.baseline_amount, baseline_date = excluded.baseline_date, updated_at = now();
end; $$;

revoke all on function public.set_emergency_reserve_target(smallint) from public, anon;
grant execute on function public.set_emergency_reserve_target(smallint) to authenticated;
revoke all on function public.set_emergency_reserve_baseline(numeric, date) from public, anon;
grant execute on function public.set_emergency_reserve_baseline(numeric, date) to authenticated;

-- 3. Categoria nova para usuários existentes (backfill idempotente)
insert into public.categories (id, user_id, name, type, color, icon, custom)
select 'reserva-emergencia', u.id, 'Reserva de emergência', 'reinvested', '#0891b2', '🛟', false
from auth.users u
on conflict (user_id, id) do nothing;

-- 4. Novas contas: mesmo corpo do BLOCO 14, com a linha nova (após outros-ri)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data->>'full_name', ''), 120), '')
  )
  on conflict (id) do nothing;

  insert into public.categories (id, user_id, name, type, color, icon, custom)
  values
    ('moradia',       new.id, 'Moradia',           'expense', '#6366f1', '🏠', false),
    ('alimentacao',   new.id, 'Alimentação',       'expense', '#f97316', '🍽️', false),
    ('mercado',       new.id, 'Mercado',           'expense', '#84cc16', '🛒', false),
    ('transporte',    new.id, 'Transporte',        'expense', '#0ea5e9', '🚗', false),
    ('saude',         new.id, 'Saúde',             'expense', '#ef4444', '💊', false),
    ('educacao',      new.id, 'Educação',          'expense', '#8b5cf6', '📚', false),
    ('lazer',         new.id, 'Lazer',             'expense', '#ec4899', '🎬', false),
    ('assinaturas',   new.id, 'Assinaturas',       'expense', '#14b8a6', '📺', false),
    ('compras',       new.id, 'Compras',           'expense', '#f59e0b', '🛍️', false),
    ('pets',          new.id, 'Pets',              'expense', '#a3703a', '🐾', false),
    ('dividas',       new.id, 'Dívidas',           'expense', '#dc2626', '💳', false),
    ('impostos',      new.id, 'Impostos',          'expense', '#64748b', '🧾', false),
    ('outros-d',      new.id, 'Outros',            'expense', '#94a3b8', '📦', false),
    ('aportes',       new.id, 'Aportes e investimentos', 'reinvested', '#8b5cf6', '📈', false),
    ('outros-ri',     new.id, 'Outros reinvestimentos',  'reinvested', '#a855f7', '📦', false),
    ('reserva-emergencia', new.id, 'Reserva de emergência', 'reinvested', '#0891b2', '🛟', false),
    ('salario',       new.id, 'Salário',           'income',  '#22c55e', '💼', false),
    ('freelance',     new.id, 'Freelance',         'income',  '#10b981', '💻', false),
    ('investimentos', new.id, 'Investimentos',     'income',  '#0d9488', '📈', false),
    ('aluguel-r',     new.id, 'Aluguel recebido',  'income',  '#059669', '🏘️', false),
    ('presente',      new.id, 'Presente',          'income',  '#a855f7', '🎁', false),
    ('reembolso',     new.id, 'Reembolso',         'income',  '#3b82f6', '↩️', false),
    ('outros-r',      new.id, 'Outros',            'income',  '#7dd3fc', '➕', false)
  on conflict (user_id, id) do nothing;

  return new;
end;
$$;

-- 5. reset_my_data_with_defaults: mesma lista de categorias + reserva-emergencia
create or replace function public.reset_my_data_with_defaults()
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

  perform public.delete_my_data();

  insert into public.categories (id, user_id, name, type, color, icon, custom, target_percentage)
  values
    ('moradia', v_uid, 'Moradia', 'expense', '#6366f1', '🏠', false, 0),
    ('alimentacao', v_uid, 'Alimentação', 'expense', '#f97316', '🍽️', false, 0),
    ('mercado', v_uid, 'Mercado', 'expense', '#84cc16', '🛒', false, 0),
    ('transporte', v_uid, 'Transporte', 'expense', '#0ea5e9', '🚗', false, 0),
    ('saude', v_uid, 'Saúde', 'expense', '#ef4444', '💊', false, 0),
    ('educacao', v_uid, 'Educação', 'expense', '#8b5cf6', '📚', false, 0),
    ('lazer', v_uid, 'Lazer', 'expense', '#ec4899', '🎬', false, 0),
    ('assinaturas', v_uid, 'Assinaturas', 'expense', '#14b8a6', '📺', false, 0),
    ('compras', v_uid, 'Compras', 'expense', '#f59e0b', '🛍️', false, 0),
    ('pets', v_uid, 'Pets', 'expense', '#a3703a', '🐾', false, 0),
    ('dividas', v_uid, 'Dívidas', 'expense', '#dc2626', '💳', false, 0),
    ('impostos', v_uid, 'Impostos', 'expense', '#64748b', '🧾', false, 0),
    ('outros-d', v_uid, 'Outros', 'expense', '#94a3b8', '📦', false, 0),
    ('aportes', v_uid, 'Aportes e investimentos', 'reinvested', '#8b5cf6', '📈', false, 0),
    ('outros-ri', v_uid, 'Outros reinvestimentos', 'reinvested', '#a855f7', '📦', false, 0),
    ('reserva-emergencia', v_uid, 'Reserva de emergência', 'reinvested', '#0891b2', '🛟', false, 0),
    ('salario', v_uid, 'Salário', 'income', '#22c55e', '💼', false, 0),
    ('freelance', v_uid, 'Freelance', 'income', '#10b981', '💻', false, 0),
    ('investimentos', v_uid, 'Investimentos', 'income', '#0d9488', '📈', false, 0),
    ('aluguel-r', v_uid, 'Aluguel recebido', 'income', '#059669', '🏘️', false, 0),
    ('presente', v_uid, 'Presente', 'income', '#a855f7', '🎁', false, 0),
    ('reembolso', v_uid, 'Reembolso', 'income', '#3b82f6', '↩️', false, 0),
    ('outros-r', v_uid, 'Outros', 'income', '#7dd3fc', '➕', false, 0);
end;
$$;

-- 6. delete_my_data: apagar também a reserva (senão a base sobrevive ao reset)
create or replace function public.delete_my_data()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000';
  end if;
  delete from public.transactions where user_id = v_uid;
  delete from public.budgets where user_id = v_uid;
  delete from public.goals where user_id = v_uid;
  delete from public.categories where user_id = v_uid;
  delete from public.pgbl_plans where user_id = v_uid;
  delete from public.emergency_reserve where user_id = v_uid;
  insert into public.security_events (user_id, event_type, severity, details)
  values (v_uid, 'bulk_delete', 'warning', jsonb_build_object('scope', 'all_financial_data'));
end; $$;

-- 7. replace_my_data: apagar a reserva no delete (paridade; sem reimport da base)
create or replace function public.replace_my_data(p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); item record;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtext('replace_my_data:' || u::text));
  if jsonb_typeof(p_data) <> 'object' then raise exception 'backup invalido' using errcode='22023'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_data->'goals','[]'::jsonb)) x(id text,goal_type text,reverse_completed_at timestamptz) where coalesce(x.goal_type,'standard')='reverse' and x.reverse_completed_at is not null and not exists (select 1 from jsonb_to_recordset(coalesce(p_data->'reverseGoalHistory','[]'::jsonb)) h(goal_id text) where h.goal_id=x.id)) then raise exception 'backup de meta reversa concluida sem historico' using errcode='22023'; end if;
  delete from public.transactions where user_id=u; delete from public.budgets where user_id=u; delete from public.goals where user_id=u; delete from public.categories where user_id=u; delete from public.pgbl_plans where user_id=u; delete from public.reverse_goal_retention_settings where user_id=u; delete from public.emergency_reserve where user_id=u;
  insert into public.categories(user_id,id,name,icon,color,type,target_percentage) select u,x.id,x.name,x.icon,x.color,x.type,coalesce(x.target_percentage,0) from jsonb_to_recordset(coalesce(p_data->'categories','[]'::jsonb)) x(id text,name text,icon text,color text,type text,target_percentage numeric);
  insert into public.transactions(user_id,id,type,description,amount,category_id,date,method,paid,recurrence,recurrence_end,installments,tags,note,paid_occurrences,created_at,updated_at) select u,x.id,x.type,x.description,x.amount,x.category_id,x.date,x.method,x.paid,x.recurrence,x.recurrence_end,x.installments,x.tags,x.note,x.paid_occurrences,coalesce(x.created_at,now()),coalesce(x.updated_at,now()) from jsonb_to_recordset(coalesce(p_data->'transactions','[]'::jsonb)) x(id text,type text,description text,amount numeric,category_id text,date date,method text,paid boolean,recurrence text,recurrence_end date,installments integer,tags text[],note text,paid_occurrences jsonb,created_at timestamptz,updated_at timestamptz);
  insert into public.budgets(user_id,category_id,limit_amount) select u,x.category_id,x.limit_amount from jsonb_to_recordset(coalesce(p_data->'budgets','[]'::jsonb)) x(category_id text,limit_amount numeric);
  insert into public.goals(user_id,id,name,target,current,deadline,icon,color,goal_type,reverse_original_amount,reverse_remaining_amount,reverse_corrected_amount,reverse_start_date,reverse_selic_factor,reverse_completed_at,reverse_total_contributed,reverse_correction_amount,reverse_progress_percent,reverse_monthly_contribution_average,reverse_forecast_completion_date) select u,x.id,x.name,x.target,x.current,x.deadline,x.icon,x.color,coalesce(x.goal_type,'standard'),x.reverse_original_amount,x.reverse_remaining_amount,x.reverse_corrected_amount,x.reverse_start_date,x.reverse_selic_factor,x.reverse_completed_at,coalesce(x.reverse_total_contributed,0),coalesce(x.reverse_correction_amount,0),coalesce(x.reverse_progress_percent,0),x.reverse_monthly_contribution_average,x.reverse_forecast_completion_date from jsonb_to_recordset(coalesce(p_data->'goals','[]'::jsonb)) x(id text,name text,target numeric,current numeric,deadline date,icon text,color text,goal_type text,reverse_original_amount numeric,reverse_remaining_amount numeric,reverse_corrected_amount numeric,reverse_start_date date,reverse_selic_factor numeric,reverse_completed_at timestamptz,reverse_total_contributed numeric,reverse_correction_amount numeric,reverse_progress_percent numeric,reverse_monthly_contribution_average numeric,reverse_forecast_completion_date date);
  if p_data ? 'standardGoalContributions' then
    insert into public.standard_goal_contributions(goal_id,user_id,amount,occurred_on,note) select x.goal_id,u,round(x.amount,2),x.occurred_on,nullif(btrim(x.note),'') from jsonb_to_recordset(coalesce(p_data->'standardGoalContributions','[]'::jsonb)) x(goal_id text,amount numeric,occurred_on date,note text) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='standard';
  else
    insert into public.standard_goal_contributions(goal_id,user_id,amount,occurred_on,note) select g.id,u,round(g.current,2),coalesce(g.updated_at::date,current_date),'Saldo restaurado' from public.goals g where g.user_id=u and g.goal_type='standard' and g.current>0;
  end if;
  update public.goals g set current=coalesce((select round(sum(c.amount),2) from public.standard_goal_contributions c where c.user_id=u and c.goal_id=g.id),0),updated_at=now() where g.user_id=u and g.goal_type='standard';
  insert into public.reverse_goal_contributions(goal_id,user_id,amount,occurred_on,note) select x.goal_id,u,x.amount,x.occurred_on,x.note from jsonb_to_recordset(coalesce(p_data->'reverseGoalContributions','[]'::jsonb)) x(goal_id text,amount numeric,occurred_on date,note text) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  insert into public.reverse_goal_history(goal_id,user_id,reference_month,applied_on,balance_before,balance_after,selic_rate_percent,selic_factor,correction_amount,contribution_amount) select x.goal_id,u,x.reference_month,x.applied_on,x.balance_before,x.balance_after,x.selic_rate_percent,x.selic_factor,x.correction_amount,x.contribution_amount from jsonb_to_recordset(coalesce(p_data->'reverseGoalHistory','[]'::jsonb)) x(goal_id text,reference_month date,applied_on date,balance_before numeric,balance_after numeric,selic_rate_percent numeric,selic_factor numeric,correction_amount numeric,contribution_amount numeric) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) select x.goal_id,u,x.event_type,x.occurred_on,coalesce(x.details,'{}'::jsonb) from jsonb_to_recordset(coalesce(p_data->'reverseGoalEvents','[]'::jsonb)) x(goal_id text,event_type text,occurred_on date,details jsonb) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  insert into public.pgbl_plans(user_id,year,months,premise,fiscal_params) select u,x.year,x.months,x.premise,x.fiscal_params from jsonb_to_recordset(coalesce(p_data->'pgblPlans','[]'::jsonb)) x(year integer,months jsonb,premise jsonb,fiscal_params jsonb);
  if p_data ? 'reverseGoalRetentionMonths' then insert into public.reverse_goal_retention_settings(user_id,completed_goal_retention_months) values(u,nullif(p_data->>'reverseGoalRetentionMonths','')::smallint); end if;
  for item in select id from public.goals where user_id=u and goal_type='reverse' and reverse_completed_at is null loop perform public.rebuild_reverse_goal_for_user(item.id,u); end loop;
end; $$;

commit;
