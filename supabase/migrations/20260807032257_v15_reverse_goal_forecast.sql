alter table public.goals add column if not exists reverse_monthly_contribution_average numeric(14,2);
alter table public.goals add column if not exists reverse_forecast_completion_date date;

create or replace function public.refresh_reverse_goal_forecast(p_goal_id text,p_user_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare avg_amount numeric(14,2); remaining numeric(14,2); months numeric; completed_at timestamptz;
begin
 select reverse_remaining_amount, reverse_completed_at into remaining, completed_at from public.goals where id=p_goal_id and user_id=p_user_id;
 select case when count(distinct date_trunc('month',occurred_on))>0 then round(sum(amount)/count(distinct date_trunc('month',occurred_on)),2) end into avg_amount from public.reverse_goal_contributions where goal_id=p_goal_id and user_id=p_user_id;
 months:=case when avg_amount>0 then ceil(remaining/avg_amount) end;
 update public.goals set reverse_monthly_contribution_average=avg_amount,reverse_forecast_completion_date=case when completed_at is not null then completed_at::date when months is null then null else (current_date+(months::text||' months')::interval)::date end where id=p_goal_id and user_id=p_user_id;
end; $$;
revoke all on function public.refresh_reverse_goal_forecast(text,uuid) from public,anon,authenticated;

create or replace function public.refresh_reverse_goal_forecast_after_rebuild() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.goal_type = 'reverse' then
    perform public.refresh_reverse_goal_forecast(new.id, new.user_id);
  end if;
  return new;
end; $$;
revoke all on function public.refresh_reverse_goal_forecast_after_rebuild() from public,anon,authenticated;

drop trigger if exists reverse_goal_forecast_after_rebuild on public.goals;
create trigger reverse_goal_forecast_after_rebuild
after update of reverse_remaining_amount, reverse_completed_at on public.goals
for each row
when (new.goal_type = 'reverse' and (old.reverse_remaining_amount is distinct from new.reverse_remaining_amount or old.reverse_completed_at is distinct from new.reverse_completed_at))
execute function public.refresh_reverse_goal_forecast_after_rebuild();

-- Preenche a nova informacao tambem para metas ja existentes, sem regravar
-- historico ou aportes.
do $$
declare item record;
begin
  for item in select id, user_id from public.goals where goal_type = 'reverse' loop
    perform public.refresh_reverse_goal_forecast(item.id, item.user_id);
  end loop;
end;
$$;