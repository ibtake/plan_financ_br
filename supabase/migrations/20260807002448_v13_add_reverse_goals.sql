alter table public.goals
  add column if not exists goal_type text not null default 'standard',
  add column if not exists reverse_original_amount numeric(14,2),
  add column if not exists reverse_remaining_amount numeric(14,2),
  add column if not exists reverse_corrected_amount numeric(14,2),
  add column if not exists reverse_start_date date,
  add column if not exists reverse_selic_factor numeric(6,4),
  add column if not exists reverse_completed_at timestamptz;

alter table public.goals
  drop constraint if exists goals_goal_type_check,
  add constraint goals_goal_type_check check (goal_type in ('standard', 'reverse')),
  drop constraint if exists goals_reverse_data_check,
  add constraint goals_reverse_data_check check (
    goal_type = 'standard' or (
      reverse_original_amount > 0 and
      reverse_remaining_amount >= 0 and
      reverse_corrected_amount >= 0 and
      reverse_start_date is not null and
      reverse_selic_factor between 0.5000 and 1.5000
    )
  );

create table if not exists public.selic_monthly_rates (
  reference_month date primary key,
  rate_percent numeric(10,6) not null check (rate_percent >= 0 and rate_percent < 100),
  source text not null default 'BCB_SGS_4390' check (source = 'BCB_SGS_4390'),
  source_observed_on date not null,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (date_trunc('month', reference_month)::date = reference_month)
);

create table if not exists public.reverse_goal_contributions (
  id bigint generated always as identity primary key,
  goal_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  foreign key (user_id, goal_id) references public.goals(user_id, id) on delete cascade
);

create index if not exists reverse_goal_contributions_goal_date_idx
  on public.reverse_goal_contributions (goal_id, occurred_on, id);

create table if not exists public.reverse_goal_history (
  id bigint generated always as identity primary key,
  goal_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  reference_month date not null,
  applied_on date not null,
  balance_before numeric(14,2) not null check (balance_before >= 0),
  balance_after numeric(14,2) not null check (balance_after >= 0),
  selic_rate_percent numeric(10,6) not null check (selic_rate_percent >= 0),
  selic_factor numeric(6,4) not null check (selic_factor between 0.5000 and 1.5000),
  correction_amount numeric(14,2) not null check (correction_amount >= 0),
  contribution_amount numeric(14,2) not null check (contribution_amount >= 0),
  created_at timestamptz not null default now(),
  unique (user_id, goal_id, reference_month),
  check (date_trunc('month', reference_month)::date = reference_month),
  foreign key (user_id, goal_id) references public.goals(user_id, id) on delete cascade
);

create index if not exists reverse_goal_history_goal_month_idx
  on public.reverse_goal_history (goal_id, reference_month desc);

alter table public.selic_monthly_rates enable row level security;
alter table public.selic_monthly_rates force row level security;
alter table public.reverse_goal_contributions enable row level security;
alter table public.reverse_goal_contributions force row level security;
alter table public.reverse_goal_history enable row level security;
alter table public.reverse_goal_history force row level security;

create policy "authenticated read selic monthly rates"
  on public.selic_monthly_rates for select to authenticated
  using (public.is_token_valid() and public.has_required_aal());

create policy "own reverse goal contributions select"
  on public.reverse_goal_contributions for select to authenticated
  using (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());

create policy "own reverse goal history select"
  on public.reverse_goal_history for select to authenticated
  using (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());

grant select on public.selic_monthly_rates to authenticated;
grant select on public.reverse_goal_contributions to authenticated;
grant select on public.reverse_goal_history to authenticated;

create or replace function public.rebuild_reverse_goal(p_goal_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_goal public.goals%rowtype;
  v_period date;
  v_last_complete date := (date_trunc('month', current_date)::date - interval '1 month')::date;
  v_rate numeric(10,6);
  v_balance numeric(14,2);
  v_correction numeric(14,2);
  v_contribution numeric(14,2);
  v_corrected_total numeric(14,2);
begin
  select * into v_goal from public.goals where id = p_goal_id for update;
  if not found or v_goal.goal_type <> 'reverse' then
    raise exception 'meta reversa nao encontrada' using errcode = 'P0002';
  end if;

  delete from public.reverse_goal_history where goal_id = v_goal.id;
  v_balance := v_goal.reverse_original_amount;
  v_corrected_total := v_goal.reverse_original_amount;
  v_period := date_trunc('month', v_goal.reverse_start_date)::date;

  while v_period <= v_last_complete loop
    select rate_percent into v_rate
    from public.selic_monthly_rates
    where reference_month = v_period;
    exit when not found;

    v_correction := round(v_balance * (v_rate / 100) * v_goal.reverse_selic_factor, 2);
    select coalesce(sum(amount), 0)::numeric(14,2) into v_contribution
    from public.reverse_goal_contributions
    where goal_id = v_goal.id
      and occurred_on >= v_period
      and occurred_on < (v_period + interval '1 month')::date;

    insert into public.reverse_goal_history (
      goal_id, user_id, reference_month, applied_on, balance_before, balance_after,
      selic_rate_percent, selic_factor, correction_amount, contribution_amount
    ) values (
      v_goal.id, v_goal.user_id, v_period,
      (v_period + interval '1 month')::date, v_balance,
      greatest(0, round(v_balance + v_correction - v_contribution, 2)),
      v_rate, v_goal.reverse_selic_factor, v_correction, v_contribution
    );

    v_balance := greatest(0, round(v_balance + v_correction - v_contribution, 2));
    v_corrected_total := round(v_corrected_total + v_correction, 2);
    v_period := (v_period + interval '1 month')::date;
  end loop;

  -- Aportes apos o ultimo mes com taxa disponivel aparecem no saldo atual;
  -- quando a taxa chegar, a reconstrucao reprocessa toda a linha do tempo.
  select coalesce(sum(amount), 0)::numeric(14,2) into v_contribution
  from public.reverse_goal_contributions
  where goal_id = v_goal.id and occurred_on >= v_period;
  v_balance := greatest(0, round(v_balance - v_contribution, 2));

  update public.goals
  set reverse_remaining_amount = v_balance,
      reverse_corrected_amount = v_corrected_total,
      target = v_corrected_total,
      current = greatest(0, round(v_corrected_total - v_balance, 2)),
      reverse_completed_at = case when v_balance = 0 then coalesce(reverse_completed_at, now()) else null end,
      updated_at = now()
  where id = v_goal.id;
end;
$$;

create or replace function public.create_reverse_goal(
  p_name text,
  p_original_amount numeric,
  p_initial_contribution numeric,
  p_start_date date,
  p_selic_factor numeric,
  p_icon text default '🎯',
  p_color text default '#6366f1'
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_goal_id text := gen_random_uuid()::text;
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000';
  end if;
  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 120 then
    raise exception 'nome da meta invalido' using errcode = '22023';
  end if;
  if p_original_amount <= 0 or p_initial_contribution < 0 or p_initial_contribution > p_original_amount then
    raise exception 'valores da meta invalidos' using errcode = '22023';
  end if;
  if p_start_date is null or p_start_date > current_date or p_selic_factor not between 0.5000 and 1.5000 then
    raise exception 'data ou fator Selic invalido' using errcode = '22023';
  end if;

  insert into public.goals (
    id, user_id, name, target, current, deadline, icon, color, goal_type,
    reverse_original_amount, reverse_remaining_amount, reverse_corrected_amount,
    reverse_start_date, reverse_selic_factor
  ) values (
    v_goal_id, v_uid, btrim(p_name), p_original_amount, p_initial_contribution,
    null, left(coalesce(p_icon, '🎯'), 8), coalesce(p_color, '#6366f1'), 'reverse',
    p_original_amount, p_original_amount - p_initial_contribution, p_original_amount,
    p_start_date, round(p_selic_factor, 4)
  );

  if p_initial_contribution > 0 then
    insert into public.reverse_goal_contributions (goal_id, user_id, amount, occurred_on, note)
    values (v_goal_id, v_uid, round(p_initial_contribution, 2), p_start_date, 'Aporte inicial');
  end if;
  perform public.rebuild_reverse_goal(v_goal_id);
  return v_goal_id;
end;
$$;

create or replace function public.add_reverse_goal_contribution(
  p_goal_id text,
  p_amount numeric,
  p_occurred_on date,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_start_date date;
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000';
  end if;
  select reverse_start_date into v_start_date from public.goals
  where id = p_goal_id and user_id = v_uid and goal_type = 'reverse';
  if not found then raise exception 'meta reversa nao encontrada' using errcode = 'P0002'; end if;
  if p_amount <= 0 or p_occurred_on is null or p_occurred_on < v_start_date or p_occurred_on > current_date then
    raise exception 'aporte invalido' using errcode = '22023';
  end if;
  if p_note is not null and char_length(p_note) > 500 then raise exception 'observacao invalida' using errcode = '22023'; end if;
  insert into public.reverse_goal_contributions (goal_id, user_id, amount, occurred_on, note)
  values (p_goal_id, v_uid, round(p_amount, 2), p_occurred_on, nullif(btrim(p_note), ''));
  perform public.rebuild_reverse_goal(p_goal_id);
end;
$$;

create or replace function public.rebuild_all_reverse_goals()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_goal record; v_count integer := 0;
begin
  for v_goal in select id from public.goals where goal_type = 'reverse' and reverse_completed_at is null loop
    perform public.rebuild_reverse_goal(v_goal.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.rebuild_reverse_goal(text) from public, anon, authenticated;
revoke all on function public.rebuild_all_reverse_goals() from public, anon, authenticated;
revoke all on function public.create_reverse_goal(text, numeric, numeric, date, numeric, text, text) from public, anon;
revoke all on function public.add_reverse_goal_contribution(text, numeric, date, text) from public, anon;
grant execute on function public.create_reverse_goal(text, numeric, numeric, date, numeric, text, text) to authenticated;
grant execute on function public.add_reverse_goal_contribution(text, numeric, date, text) to authenticated;

-- COMPLEMENTO V1.3.0: resumo persistido, memoria de calculo e retencao.
-- Esta secao integra a primeira entrega antes de sua aplicacao. Os valores do
-- resumo sao sempre calculados no PostgreSQL, nunca no navegador.
alter table public.goals
  add column if not exists reverse_total_contributed numeric(14,2) not null default 0,
  add column if not exists reverse_correction_amount numeric(14,2) not null default 0,
  add column if not exists reverse_progress_percent numeric(6,2) not null default 0;

alter table public.goals
  drop constraint if exists goals_reverse_summary_check,
  add constraint goals_reverse_summary_check check (
    reverse_total_contributed >= 0 and reverse_correction_amount >= 0
    and reverse_progress_percent between 0 and 100
  );

create table if not exists public.reverse_goal_events (
  id bigint generated always as identity primary key,
  goal_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'contribution', 'recalculated', 'completed')),
  occurred_on date not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (user_id, goal_id) references public.goals(user_id, id) on delete cascade
);

create index if not exists reverse_goal_events_goal_date_idx
  on public.reverse_goal_events (goal_id, occurred_on, id);

create table if not exists public.reverse_goal_retention_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  completed_goal_retention_months smallint check (completed_goal_retention_months between 1 and 12),
  updated_at timestamptz not null default now()
);

alter table public.reverse_goal_events enable row level security;
alter table public.reverse_goal_events force row level security;
alter table public.reverse_goal_retention_settings enable row level security;
alter table public.reverse_goal_retention_settings force row level security;

create policy "own reverse goal events select"
  on public.reverse_goal_events for select to authenticated
  using (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());

create policy "own reverse goal retention select"
  on public.reverse_goal_retention_settings for select to authenticated
  using (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());

grant select on public.reverse_goal_events, public.reverse_goal_retention_settings to authenticated;

create or replace function public.rebuild_reverse_goal(p_goal_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_goal public.goals%rowtype;
  v_period date;
  v_last_complete date := (date_trunc('month', current_date)::date - interval '1 month')::date;
  v_rate numeric(10,6);
  v_balance numeric(14,2);
  v_correction numeric(14,2);
  v_contribution numeric(14,2);
  v_correction_total numeric(14,2) := 0;
  v_total_contributed numeric(14,2) := 0;
  v_completed_now boolean := false;
  v_completion_date date;
begin
  select * into v_goal from public.goals where id = p_goal_id for update;
  if not found or v_goal.goal_type <> 'reverse' then
    raise exception 'meta reversa nao encontrada' using errcode = 'P0002';
  end if;
  -- A conclusao e definitiva: historico e valores nao voltam a ser processados.
  if v_goal.reverse_completed_at is not null or coalesce(v_goal.reverse_remaining_amount, 0) = 0 then
    return;
  end if;

  delete from public.reverse_goal_history where goal_id = v_goal.id;
  v_balance := v_goal.reverse_original_amount;
  v_period := date_trunc('month', v_goal.reverse_start_date)::date;

  while v_period <= v_last_complete loop
    select rate_percent into v_rate from public.selic_monthly_rates where reference_month = v_period;
    exit when not found;
    select coalesce(sum(amount), 0)::numeric(14,2) into v_contribution
      from public.reverse_goal_contributions
      where goal_id = v_goal.id and occurred_on >= v_period and occurred_on < (v_period + interval '1 month')::date;
    v_total_contributed := v_total_contributed + v_contribution;
    -- O aporte reduz o saldo que existia naquele mes antes da correcao mensal.
    v_correction := case when v_balance <= v_contribution then 0 else round((v_balance - v_contribution) * (v_rate / 100) * v_goal.reverse_selic_factor, 2) end;
    insert into public.reverse_goal_history (
      goal_id, user_id, reference_month, applied_on, balance_before, balance_after,
      selic_rate_percent, selic_factor, correction_amount, contribution_amount
    ) values (
      v_goal.id, v_goal.user_id, v_period, (v_period + interval '1 month')::date,
      v_balance, greatest(0, round(v_balance - v_contribution + v_correction, 2)),
      v_rate, v_goal.reverse_selic_factor, v_correction, v_contribution
    );
    v_balance := greatest(0, round(v_balance - v_contribution + v_correction, 2));
    v_correction_total := round(v_correction_total + v_correction, 2);
    if v_balance = 0 then
      select max(occurred_on) into v_completion_date from public.reverse_goal_contributions
      where goal_id = v_goal.id and occurred_on >= v_period and occurred_on < (v_period + interval '1 month')::date;
    end if;
    exit when v_balance = 0;
    v_period := (v_period + interval '1 month')::date;
  end loop;

  if v_balance > 0 then
    select coalesce(sum(amount), 0)::numeric(14,2) into v_contribution
      from public.reverse_goal_contributions where goal_id = v_goal.id and occurred_on >= v_period;
    v_total_contributed := v_total_contributed + v_contribution;
    v_balance := greatest(0, round(v_balance - v_contribution, 2));
    if v_balance = 0 then
      select max(occurred_on) into v_completion_date from public.reverse_goal_contributions where goal_id = v_goal.id and occurred_on >= v_period;
    end if;
  end if;
  v_completed_now := v_balance = 0;

  update public.goals set
    reverse_remaining_amount = v_balance,
    reverse_correction_amount = v_correction_total,
    reverse_corrected_amount = round(reverse_original_amount + v_correction_total, 2),
    reverse_total_contributed = v_total_contributed,
    reverse_progress_percent = case when round(reverse_original_amount + v_correction_total, 2) = 0 then 0 else round(least(100, (1 - v_balance / round(reverse_original_amount + v_correction_total, 2)) * 100), 2) end,
    target = round(reverse_original_amount + v_correction_total, 2),
    current = v_total_contributed,
    reverse_completed_at = case when v_completed_now then coalesce(v_completion_date, current_date)::timestamptz else null end,
    updated_at = now()
  where id = v_goal.id;
  if v_completed_now then
    insert into public.reverse_goal_events (goal_id, user_id, event_type, occurred_on, details)
    values (v_goal.id, v_goal.user_id, 'completed', coalesce(v_completion_date, current_date), jsonb_build_object('message', 'A meta foi concluida e nao recebera novas correcoes.'));
  end if;
end;
$$;

create or replace function public.create_reverse_goal(
  p_name text, p_original_amount numeric, p_initial_contribution numeric,
  p_start_date date, p_selic_factor numeric, p_icon text default '🎯', p_color text default '#6366f1'
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_goal_id text := gen_random_uuid()::text;
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000'; end if;
  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 120 then raise exception 'nome da meta invalido' using errcode = '22023'; end if;
  if p_original_amount <= 0 or p_initial_contribution < 0 or p_initial_contribution > p_original_amount then raise exception 'valores da meta invalidos' using errcode = '22023'; end if;
  if p_start_date is null or p_start_date > current_date or p_selic_factor not between .5 and 1.5 then raise exception 'data ou fator Selic invalido' using errcode = '22023'; end if;
  insert into public.goals (id,user_id,name,target,current,deadline,icon,color,goal_type,reverse_original_amount,reverse_remaining_amount,reverse_corrected_amount,reverse_start_date,reverse_selic_factor)
  values (v_goal_id,v_uid,btrim(p_name),p_original_amount,p_initial_contribution,null,left(coalesce(p_icon,'🎯'),8),coalesce(p_color,'#6366f1'),'reverse',p_original_amount,p_original_amount-p_initial_contribution,p_original_amount,p_start_date,round(p_selic_factor,4));
  insert into public.reverse_goal_events (goal_id,user_id,event_type,occurred_on,details) values (v_goal_id,v_uid,'created',p_start_date,jsonb_build_object('message','Meta Reversa criada.'));
  if p_initial_contribution > 0 then
    insert into public.reverse_goal_contributions (goal_id,user_id,amount,occurred_on,note) values (v_goal_id,v_uid,round(p_initial_contribution,2),p_start_date,'Aporte inicial');
    insert into public.reverse_goal_events (goal_id,user_id,event_type,occurred_on,details) values (v_goal_id,v_uid,'contribution',p_start_date,jsonb_build_object('amount',round(p_initial_contribution,2),'note','Aporte inicial'));
  end if;
  perform public.rebuild_reverse_goal(v_goal_id); return v_goal_id;
end; $$;

create or replace function public.add_reverse_goal_contribution(p_goal_id text, p_amount numeric, p_occurred_on date, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_start_date date; v_completed_at timestamptz;
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000'; end if;
  select reverse_start_date, reverse_completed_at into v_start_date, v_completed_at from public.goals where id=p_goal_id and user_id=v_uid and goal_type='reverse' for update;
  if not found then raise exception 'meta reversa nao encontrada' using errcode = 'P0002'; end if;
  if v_completed_at is not null then raise exception 'meta reversa concluida nao aceita novos aportes' using errcode = '22023'; end if;
  if p_amount <= 0 or p_occurred_on is null or p_occurred_on < v_start_date or p_occurred_on > current_date then raise exception 'aporte invalido' using errcode = '22023'; end if;
  if p_note is not null and char_length(p_note)>500 then raise exception 'observacao invalida' using errcode = '22023'; end if;
  insert into public.reverse_goal_contributions(goal_id,user_id,amount,occurred_on,note) values(p_goal_id,v_uid,round(p_amount,2),p_occurred_on,nullif(btrim(p_note),''));
  insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) values(p_goal_id,v_uid,'contribution',p_occurred_on,jsonb_build_object('amount',round(p_amount,2),'note',nullif(btrim(p_note),'')));
  if p_occurred_on < current_date then
    insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) values(p_goal_id,v_uid,'recalculated',current_date,jsonb_build_object('message','Historico recalculado devido a um aporte registrado retroativamente.','contribution_date',p_occurred_on));
  end if;
  perform public.rebuild_reverse_goal(p_goal_id);
end; $$;

create or replace function public.rebuild_all_reverse_goals()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_goal record; v_count integer := 0;
begin
  for v_goal in select id from public.goals where goal_type='reverse' and reverse_completed_at is null and reverse_remaining_amount > 0 loop
    perform public.rebuild_reverse_goal(v_goal.id); v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;

create or replace function public.set_reverse_goal_retention(p_months smallint default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000'; end if;
  if p_months is not null and p_months not between 1 and 12 then raise exception 'periodo de retencao invalido' using errcode = '22023'; end if;
  insert into public.reverse_goal_retention_settings(user_id,completed_goal_retention_months,updated_at) values(v_uid,p_months,now())
  on conflict(user_id) do update set completed_goal_retention_months=excluded.completed_goal_retention_months,updated_at=now();
end; $$;

create or replace function public.cleanup_expired_reverse_goals()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted integer;
begin
  delete from public.goals g using public.reverse_goal_retention_settings s
  where g.user_id=s.user_id and g.goal_type='reverse' and g.reverse_completed_at is not null
    and s.completed_goal_retention_months is not null
    and g.reverse_completed_at < now() - make_interval(months => s.completed_goal_retention_months);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end; $$;

revoke all on function public.set_reverse_goal_retention(smallint) from public, anon;
grant execute on function public.set_reverse_goal_retention(smallint) to authenticated;
revoke all on function public.cleanup_expired_reverse_goals() from public, anon, authenticated;