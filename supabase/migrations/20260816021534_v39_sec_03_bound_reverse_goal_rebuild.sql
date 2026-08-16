-- Migration: V39 SEC-03 - limitar valores de metas reversas e isolar rebuild global
-- Objetivo: impedir overflow/exaustao no rebuild de metas reversas.
-- Pre-condicoes: dados existentes validados sem metas fora do limite.
-- Compatibilidade: preserva assinaturas RPC e retorno inteiro do rebuild global.
-- Recuperacao: nova migration corretiva; nenhuma exclusao ou alteracao de dados.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'goals_reverse_original_limit'
      and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals
      add constraint goals_reverse_original_limit
      check (goal_type <> 'reverse' or reverse_original_amount < 1000000000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'goals_reverse_remaining_limit'
      and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals
      add constraint goals_reverse_remaining_limit
      check (goal_type <> 'reverse' or reverse_remaining_amount < 1000000000);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'goals_reverse_corrected_limit'
      and conrelid = 'public.goals'::regclass
  ) then
    alter table public.goals
      add constraint goals_reverse_corrected_limit
      check (goal_type <> 'reverse' or reverse_corrected_amount < 1000000000);
  end if;
end;
$$;

create or replace function public.rebuild_reverse_goal_for_user(p_goal_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  g public.goals%rowtype;
  p date;
  last_month date := (date_trunc('month', current_date)::date - interval '1 month')::date;
  rate numeric(10,6);
  balance numeric(14,2);
  correction numeric(14,2);
  contribution numeric(14,2);
  correction_total numeric(14,2) := 0;
  contributed_total numeric(14,2) := 0;
  completion_date date;
  final_target numeric(14,2);
begin
  select * into g
  from public.goals
  where user_id = p_user_id and id = p_goal_id
  for update;

  if not found or g.goal_type <> 'reverse' then
    raise exception 'meta reversa nao encontrada' using errcode = 'P0002';
  end if;
  if g.reverse_completed_at is not null then return; end if;

  delete from public.reverse_goal_history
  where user_id = p_user_id and goal_id = p_goal_id;
  balance := g.reverse_original_amount;
  p := date_trunc('month', g.reverse_start_date)::date;

  while p <= last_month loop
    select rate_percent into rate
    from public.selic_monthly_rates
    where reference_month = p;
    exit when not found;

    select coalesce(sum(amount), 0)::numeric(14,2) into contribution
    from public.reverse_goal_contributions
    where user_id = p_user_id
      and goal_id = p_goal_id
      and occurred_on >= p
      and occurred_on < (p + interval '1 month')::date;

    contributed_total := contributed_total + contribution;
    correction := case
      when balance <= contribution then 0
      else round((balance - contribution) * (rate / 100) * g.reverse_selic_factor, 2)
    end;
    balance := greatest(0, round(balance - contribution + correction, 2));
    correction_total := round(correction_total + correction, 2);

    insert into public.reverse_goal_history
      (goal_id, user_id, reference_month, applied_on, balance_before,
       balance_after, selic_rate_percent, selic_factor, correction_amount,
       contribution_amount)
    values
      (p_goal_id, p_user_id, p, (p + interval '1 month')::date,
       greatest(0, round(balance + contribution - correction, 2)), balance,
       rate, g.reverse_selic_factor, correction, contribution);

    if balance = 0 then
      select max(occurred_on) into completion_date
      from public.reverse_goal_contributions
      where user_id = p_user_id and goal_id = p_goal_id
        and occurred_on >= p
        and occurred_on < (p + interval '1 month')::date;
      exit;
    end if;
    p := (p + interval '1 month')::date;
  end loop;

  if balance > 0 then
    select coalesce(sum(amount), 0)::numeric(14,2) into contribution
    from public.reverse_goal_contributions
    where user_id = p_user_id and goal_id = p_goal_id and occurred_on >= p;
    contributed_total := contributed_total + contribution;
    balance := greatest(0, round(balance - contribution, 2));
    if balance = 0 then
      select max(occurred_on) into completion_date
      from public.reverse_goal_contributions
      where user_id = p_user_id and goal_id = p_goal_id and occurred_on >= p;
    end if;
  end if;

  final_target := round(g.reverse_original_amount + correction_total, 2);
  if final_target >= 1000000000 then
    raise exception 'reverse_goal_limit_exceeded' using errcode = '22023';
  end if;

  update public.goals
  set reverse_remaining_amount = balance,
      reverse_correction_amount = correction_total,
      reverse_corrected_amount = final_target,
      reverse_total_contributed = contributed_total,
      reverse_progress_percent = case when final_target = 0 then 0 else round(least(100, (1 - balance / final_target) * 100), 2) end,
      target = final_target,
      current = contributed_total,
      reverse_completed_at = case when balance = 0 then coalesce(reverse_completed_at, coalesce(completion_date, current_date)::timestamptz) else null end,
      updated_at = now()
  where user_id = p_user_id and id = p_goal_id;

  if balance = 0 and g.reverse_completed_at is null then
    insert into public.reverse_goal_events(goal_id, user_id, event_type, occurred_on, details)
    values (p_goal_id, p_user_id, 'completed', coalesce(completion_date, current_date),
      jsonb_build_object('message', 'A meta foi concluida e nao recebera novas correcoes.'));
  end if;
end;
$$;

create or replace function public.create_reverse_goal(p_name text, p_original_amount numeric, p_initial_contribution numeric, p_start_date date, p_selic_factor numeric, p_icon text default '🎯', p_color text default '#6366f1')
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare
  u uuid := auth.uid();
  gid text := gen_random_uuid()::text;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000';
  end if;
  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 120
     or p_original_amount <= 0 or p_original_amount >= 1000000000
     or p_initial_contribution < 0 or p_initial_contribution > p_original_amount
     or p_start_date is null or p_start_date < current_date - interval '19 years'
     or p_start_date > current_date or p_selic_factor not between .5 and 1.5 then
    if p_original_amount >= 1000000000 then
      raise exception 'reverse_goal_limit_exceeded' using errcode = '22023';
    end if;
    raise exception 'dados da meta invalidos' using errcode = '22023';
  end if;
  insert into public.goals
    (id, user_id, name, target, current, deadline, icon, color, goal_type,
     reverse_original_amount, reverse_remaining_amount, reverse_corrected_amount,
     reverse_start_date, reverse_selic_factor)
  values
    (gid, u, btrim(p_name), p_original_amount, 0, null,
     left(coalesce(p_icon, '🎯'), 8), coalesce(p_color, '#6366f1'), 'reverse',
     p_original_amount, p_original_amount, p_original_amount, p_start_date,
     round(p_selic_factor, 4));
  insert into public.reverse_goal_events(goal_id, user_id, event_type, occurred_on, details)
  values (gid, u, 'created', p_start_date, jsonb_build_object('message', 'Meta Reversa criada.'));
  if p_initial_contribution > 0 then
    insert into public.reverse_goal_contributions(goal_id, user_id, amount, occurred_on, note)
    values (gid, u, round(p_initial_contribution, 2), p_start_date, null);
    insert into public.reverse_goal_events(goal_id, user_id, event_type, occurred_on, details)
    values (gid, u, 'contribution', p_start_date, jsonb_build_object('amount', round(p_initial_contribution, 2)));
  end if;
  perform public.rebuild_reverse_goal_for_user(gid, u);
  return gid;
end;
$$;

create or replace function public.rebuild_all_reverse_goals()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare
  item record;
  n integer := 0;
begin
  for item in
    select id, user_id from public.goals
    where goal_type = 'reverse' and reverse_completed_at is null and reverse_remaining_amount > 0
  loop
    begin
      perform public.rebuild_reverse_goal_for_user(item.id, item.user_id);
      n := n + 1;
    exception when others then
      raise warning 'rebuild_reverse_goal_for_user ignorado para goal_id=% (SQLSTATE %): %', item.id, SQLSTATE, SQLERRM;
    end;
  end loop;
  return n;
end;
$$;

revoke all on function public.create_reverse_goal(text,numeric,numeric,date,numeric,text,text) from public, anon;
grant execute on function public.create_reverse_goal(text,numeric,numeric,date,numeric,text,text) to authenticated;
revoke all on function public.rebuild_all_reverse_goals() from public, anon, authenticated;
grant execute on function public.rebuild_all_reverse_goals() to service_role;
