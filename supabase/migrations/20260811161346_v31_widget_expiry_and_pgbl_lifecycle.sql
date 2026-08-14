-- migration: expira tokens do widget em 30 dias e completa o ciclo de vida do PGBL
alter table public.widget_tokens
  add column if not exists access_expires_at timestamptz,
  add column if not exists refresh_token_hash text,
  add column if not exists refresh_expires_at timestamptz;

update public.widget_tokens
set access_expires_at = coalesce(access_expires_at, now() + interval '30 days'),
    refresh_expires_at = coalesce(refresh_expires_at, now() + interval '365 days')
where access_expires_at is null or refresh_expires_at is null;

create unique index if not exists widget_tokens_refresh_hash_unique
  on public.widget_tokens(refresh_token_hash)
  where refresh_token_hash is not null;

create or replace function public.activate_widget_install_code(
  p_code_hash text,
  p_token_hash text,
  p_refresh_token_hash text
)
returns table (install_code_id uuid, user_id uuid)
language sql
security definer
set search_path = public
as $$
  with consumed as (
    update public.widget_install_codes
    set used_at = now()
    where code_hash = p_code_hash
      and used_at is null
      and expires_at > now()
    returning id, user_id
  ), inserted as (
    insert into public.widget_tokens (
      install_code_id, user_id, token_hash, refresh_token_hash,
      access_expires_at, refresh_expires_at
    )
    select id, user_id, p_token_hash, p_refresh_token_hash,
      now() + interval '30 days', now() + interval '365 days'
    from consumed
    returning install_code_id, user_id
  )
  select install_code_id, user_id from inserted;
$$;

revoke all on function public.activate_widget_install_code(text, text, text) from public, anon, authenticated;
grant execute on function public.activate_widget_install_code(text, text, text) to service_role;

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
  insert into public.security_events (user_id, event_type, severity, details)
  values (v_uid, 'bulk_delete', 'warning', jsonb_build_object('scope', 'all_financial_data'));
end; $$;
revoke all on function public.delete_my_data() from public, anon;
grant execute on function public.delete_my_data() to authenticated;

create or replace function public.replace_my_data(p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid(); item record;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000';
  end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'backup invalido' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_data->'goals','[]'::jsonb)) x(id text,goal_type text,reverse_completed_at timestamptz) where coalesce(x.goal_type,'standard')='reverse' and x.reverse_completed_at is not null and not exists (select 1 from jsonb_to_recordset(coalesce(p_data->'reverseGoalHistory','[]'::jsonb)) h(goal_id text) where h.goal_id=x.id)) then raise exception 'backup de meta reversa concluida sem historico' using errcode = '22023'; end if;
  delete from public.transactions where user_id=u;
  delete from public.budgets where user_id=u;
  delete from public.goals where user_id=u;
  delete from public.categories where user_id=u;
  delete from public.pgbl_plans where user_id=u;
  delete from public.reverse_goal_retention_settings where user_id=u;
  insert into public.categories(user_id,id,name,icon,color,type,target_percentage)
    select u,x.id,x.name,x.icon,x.color,x.type,coalesce(x.target_percentage,0)
    from jsonb_to_recordset(coalesce(p_data->'categories','[]'::jsonb)) x(id text,name text,icon text,color text,type text,target_percentage numeric);
  insert into public.transactions(user_id,id,type,description,amount,category_id,date,method,paid,recurrence,recurrence_end,installments,tags,note,paid_occurrences,created_at,updated_at)
    select u,x.id,x.type,x.description,x.amount,x.category_id,x.date,x.method,x.paid,x.recurrence,x.recurrence_end,x.installments,x.tags,x.note,x.paid_occurrences,coalesce(x.created_at,now()),coalesce(x.updated_at,now())
    from jsonb_to_recordset(coalesce(p_data->'transactions','[]'::jsonb)) x(id text,type text,description text,amount numeric,category_id text,date date,method text,paid boolean,recurrence text,recurrence_end date,installments integer,tags text[],note text,paid_occurrences jsonb,created_at timestamptz,updated_at timestamptz);
  insert into public.budgets(user_id,category_id,limit_amount)
    select u,x.category_id,x.limit_amount from jsonb_to_recordset(coalesce(p_data->'budgets','[]'::jsonb)) x(category_id text,limit_amount numeric);
  insert into public.goals(user_id,id,name,target,current,deadline,icon,color,goal_type,reverse_original_amount,reverse_remaining_amount,reverse_corrected_amount,reverse_start_date,reverse_selic_factor,reverse_completed_at,reverse_total_contributed,reverse_correction_amount,reverse_progress_percent,reverse_monthly_contribution_average,reverse_forecast_completion_date)
    select u,x.id,x.name,x.target,x.current,x.deadline,x.icon,x.color,coalesce(x.goal_type,'standard'),x.reverse_original_amount,x.reverse_remaining_amount,x.reverse_corrected_amount,x.reverse_start_date,x.reverse_selic_factor,x.reverse_completed_at,coalesce(x.reverse_total_contributed,0),coalesce(x.reverse_correction_amount,0),coalesce(x.reverse_progress_percent,0),x.reverse_monthly_contribution_average,x.reverse_forecast_completion_date
    from jsonb_to_recordset(coalesce(p_data->'goals','[]'::jsonb)) x(id text,name text,target numeric,current numeric,deadline date,icon text,color text,goal_type text,reverse_original_amount numeric,reverse_remaining_amount numeric,reverse_corrected_amount numeric,reverse_start_date date,reverse_selic_factor numeric,reverse_completed_at timestamptz,reverse_total_contributed numeric,reverse_correction_amount numeric,reverse_progress_percent numeric,reverse_monthly_contribution_average numeric,reverse_forecast_completion_date date);
  insert into public.reverse_goal_contributions(goal_id,user_id,amount,occurred_on,note)
    select x.goal_id,u,x.amount,x.occurred_on,x.note from jsonb_to_recordset(coalesce(p_data->'reverseGoalContributions','[]'::jsonb)) x(goal_id text,amount numeric,occurred_on date,note text) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  insert into public.reverse_goal_history(goal_id,user_id,reference_month,applied_on,balance_before,balance_after,selic_rate_percent,selic_factor,correction_amount,contribution_amount)
    select x.goal_id,u,x.reference_month,x.applied_on,x.balance_before,x.balance_after,x.selic_rate_percent,x.selic_factor,x.correction_amount,x.contribution_amount from jsonb_to_recordset(coalesce(p_data->'reverseGoalHistory','[]'::jsonb)) x(goal_id text,reference_month date,applied_on date,balance_before numeric,balance_after numeric,selic_rate_percent numeric,selic_factor numeric,correction_amount numeric,contribution_amount numeric) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details)
    select x.goal_id,u,x.event_type,x.occurred_on,coalesce(x.details,'{}'::jsonb) from jsonb_to_recordset(coalesce(p_data->'reverseGoalEvents','[]'::jsonb)) x(goal_id text,event_type text,occurred_on date,details jsonb) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  insert into public.pgbl_plans(user_id,year,months,premise,fiscal_params)
    select u,x.year,x.months,x.premise,x.fiscal_params
    from jsonb_to_recordset(coalesce(p_data->'pgblPlans','[]'::jsonb)) x(year integer,months jsonb,premise jsonb,fiscal_params jsonb);
  if p_data ? 'reverseGoalRetentionMonths' then insert into public.reverse_goal_retention_settings(user_id,completed_goal_retention_months) values(u,nullif(p_data->>'reverseGoalRetentionMonths','')::smallint); end if;
  for item in select id from public.goals where user_id=u and goal_type='reverse' and reverse_completed_at is null loop perform public.rebuild_reverse_goal_for_user(item.id,u); end loop;
end; $$;
revoke all on function public.replace_my_data(jsonb) from public, anon;
grant execute on function public.replace_my_data(jsonb) to authenticated;