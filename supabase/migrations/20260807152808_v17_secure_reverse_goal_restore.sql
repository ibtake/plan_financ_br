begin;

create or replace function public.rebuild_reverse_goal_for_user(p_goal_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  g public.goals%rowtype; p date;
  last_month date := (date_trunc('month',current_date)::date-interval '1 month')::date;
  rate numeric(10,6); balance numeric(14,2); correction numeric(14,2);
  contribution numeric(14,2); correction_total numeric(14,2):=0;
  contributed_total numeric(14,2):=0; completion_date date;
begin
  select * into g from public.goals where user_id=p_user_id and id=p_goal_id for update;
  if not found or g.goal_type<>'reverse' then raise exception 'meta reversa nao encontrada' using errcode='P0002'; end if;
  if g.reverse_completed_at is not null then return; end if;
  delete from public.reverse_goal_history where user_id=p_user_id and goal_id=p_goal_id;
  balance:=g.reverse_original_amount; p:=date_trunc('month',g.reverse_start_date)::date;
  while p<=last_month loop
    select rate_percent into rate from public.selic_monthly_rates where reference_month=p; exit when not found;
    select coalesce(sum(amount),0)::numeric(14,2) into contribution from public.reverse_goal_contributions where user_id=p_user_id and goal_id=p_goal_id and occurred_on>=p and occurred_on<(p+interval '1 month')::date;
    contributed_total:=contributed_total+contribution;
    correction:=case when balance<=contribution then 0 else round((balance-contribution)*(rate/100)*g.reverse_selic_factor,2) end;
    balance:=greatest(0,round(balance-contribution+correction,2)); correction_total:=round(correction_total+correction,2);
    insert into public.reverse_goal_history(goal_id,user_id,reference_month,applied_on,balance_before,balance_after,selic_rate_percent,selic_factor,correction_amount,contribution_amount) values(p_goal_id,p_user_id,p,(p+interval '1 month')::date,greatest(0,round(balance+contribution-correction,2)),balance,rate,g.reverse_selic_factor,correction,contribution);
    if balance=0 then select max(occurred_on) into completion_date from public.reverse_goal_contributions where user_id=p_user_id and goal_id=p_goal_id and occurred_on>=p and occurred_on<(p+interval '1 month')::date; exit; end if;
    p:=(p+interval '1 month')::date;
  end loop;
  if balance>0 then
    select coalesce(sum(amount),0)::numeric(14,2) into contribution from public.reverse_goal_contributions where user_id=p_user_id and goal_id=p_goal_id and occurred_on>=p;
    contributed_total:=contributed_total+contribution; balance:=greatest(0,round(balance-contribution,2));
    if balance=0 then select max(occurred_on) into completion_date from public.reverse_goal_contributions where user_id=p_user_id and goal_id=p_goal_id and occurred_on>=p; end if;
  end if;
  update public.goals set reverse_remaining_amount=balance,reverse_correction_amount=correction_total,reverse_corrected_amount=round(reverse_original_amount+correction_total,2),reverse_total_contributed=contributed_total,reverse_progress_percent=case when round(reverse_original_amount+correction_total,2)=0 then 0 else round(least(100,(1-balance/round(reverse_original_amount+correction_total,2))*100),2) end,target=round(reverse_original_amount+correction_total,2),current=contributed_total,reverse_completed_at=case when balance=0 then coalesce(reverse_completed_at,coalesce(completion_date,current_date)::timestamptz) else null end,updated_at=now() where user_id=p_user_id and id=p_goal_id;
  if balance=0 and g.reverse_completed_at is null then insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) values(p_goal_id,p_user_id,'completed',coalesce(completion_date,current_date),jsonb_build_object('message','A meta foi concluida e nao recebera novas correcoes.')); end if;
end; $$;
revoke all on function public.rebuild_reverse_goal_for_user(text,uuid) from public,anon,authenticated;

create or replace function public.replace_my_data(p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); item record;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'backup invalido' using errcode='22023'; end if;
  if exists (
    select 1 from jsonb_to_recordset(coalesce(p_data->'goals','[]'::jsonb)) x(id text,goal_type text,reverse_completed_at timestamptz)
    where coalesce(x.goal_type,'standard')='reverse' and x.reverse_completed_at is not null
      and not exists (select 1 from jsonb_to_recordset(coalesce(p_data->'reverseGoalHistory','[]'::jsonb)) h(goal_id text) where h.goal_id=x.id)
  ) then raise exception 'backup de meta reversa concluida sem historico' using errcode='22023'; end if;
  delete from public.transactions where user_id=u; delete from public.budgets where user_id=u; delete from public.goals where user_id=u; delete from public.categories where user_id=u; delete from public.reverse_goal_retention_settings where user_id=u;
  insert into public.categories(user_id,id,name,icon,color,type,target_percentage) select u,x.id,x.name,x.icon,x.color,x.type,coalesce(x.target_percentage,0) from jsonb_to_recordset(coalesce(p_data->'categories','[]'::jsonb)) x(id text,name text,icon text,color text,type text,target_percentage numeric);
  insert into public.transactions(user_id,id,type,description,amount,category_id,date,method,paid,recurrence,recurrence_end,installments,tags,note,paid_occurrences,created_at,updated_at) select u,x.id,x.type,x.description,x.amount,x.category_id,x.date,x.method,x.paid,x.recurrence,x.recurrence_end,x.installments,x.tags,x.note,x.paid_occurrences,coalesce(x.created_at,now()),coalesce(x.updated_at,now()) from jsonb_to_recordset(coalesce(p_data->'transactions','[]'::jsonb)) x(id text,type text,description text,amount numeric,category_id text,date date,method text,paid boolean,recurrence text,recurrence_end date,installments integer,tags text[],note text,paid_occurrences jsonb,created_at timestamptz,updated_at timestamptz);
  insert into public.budgets(user_id,category_id,limit_amount) select u,x.category_id,x.limit_amount from jsonb_to_recordset(coalesce(p_data->'budgets','[]'::jsonb)) x(category_id text,limit_amount numeric);
  insert into public.goals(user_id,id,name,target,current,deadline,icon,color,goal_type,reverse_original_amount,reverse_remaining_amount,reverse_corrected_amount,reverse_start_date,reverse_selic_factor,reverse_completed_at,reverse_total_contributed,reverse_correction_amount,reverse_progress_percent,reverse_monthly_contribution_average,reverse_forecast_completion_date) select u,x.id,x.name,x.target,x.current,x.deadline,x.icon,x.color,coalesce(x.goal_type,'standard'),x.reverse_original_amount,x.reverse_remaining_amount,x.reverse_corrected_amount,x.reverse_start_date,x.reverse_selic_factor,x.reverse_completed_at,coalesce(x.reverse_total_contributed,0),coalesce(x.reverse_correction_amount,0),coalesce(x.reverse_progress_percent,0),x.reverse_monthly_contribution_average,x.reverse_forecast_completion_date from jsonb_to_recordset(coalesce(p_data->'goals','[]'::jsonb)) x(id text,name text,target numeric,current numeric,deadline date,icon text,color text,goal_type text,reverse_original_amount numeric,reverse_remaining_amount numeric,reverse_corrected_amount numeric,reverse_start_date date,reverse_selic_factor numeric,reverse_completed_at timestamptz,reverse_total_contributed numeric,reverse_correction_amount numeric,reverse_progress_percent numeric,reverse_monthly_contribution_average numeric,reverse_forecast_completion_date date);
  insert into public.reverse_goal_contributions(goal_id,user_id,amount,occurred_on,note) select x.goal_id,u,x.amount,x.occurred_on,x.note from jsonb_to_recordset(coalesce(p_data->'reverseGoalContributions','[]'::jsonb)) x(goal_id text,amount numeric,occurred_on date,note text) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  insert into public.reverse_goal_history(goal_id,user_id,reference_month,applied_on,balance_before,balance_after,selic_rate_percent,selic_factor,correction_amount,contribution_amount) select x.goal_id,u,x.reference_month,x.applied_on,x.balance_before,x.balance_after,x.selic_rate_percent,x.selic_factor,x.correction_amount,x.contribution_amount from jsonb_to_recordset(coalesce(p_data->'reverseGoalHistory','[]'::jsonb)) x(goal_id text,reference_month date,applied_on date,balance_before numeric,balance_after numeric,selic_rate_percent numeric,selic_factor numeric,correction_amount numeric,contribution_amount numeric) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) select x.goal_id,u,x.event_type,x.occurred_on,coalesce(x.details,'{}'::jsonb) from jsonb_to_recordset(coalesce(p_data->'reverseGoalEvents','[]'::jsonb)) x(goal_id text,event_type text,occurred_on date,details jsonb) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  if p_data ? 'reverseGoalRetentionMonths' then insert into public.reverse_goal_retention_settings(user_id,completed_goal_retention_months) values(u,nullif(p_data->>'reverseGoalRetentionMonths','')::smallint); end if;
  for item in select id from public.goals where user_id=u and goal_type='reverse' and reverse_completed_at is null loop perform public.rebuild_reverse_goal_for_user(item.id,u); end loop;
end; $$;
revoke all on function public.replace_my_data(jsonb) from public,anon;
grant execute on function public.replace_my_data(jsonb) to authenticated;

commit;