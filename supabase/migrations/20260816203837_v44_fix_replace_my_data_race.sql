-- =====================================================================
-- migration: v44 - serializar restores concorrentes por usuario
-- =====================================================================
--
-- OBJETIVO
--   Fechar o achado vuln-0001 do pentest de 16/08 (CWE-362): dois
--   replace_my_data simultaneos para o mesmo usuario (duas abas, ou retry
--   do cliente racing a requisicao original) intercalavam delete+insert
--   em transacoes separadas e ambos commitavam, deixando a UNIAO dos dois
--   payloads com sucesso reportado para os dois - corrupcao silenciosa
--   dos proprios dados financeiros.
--
-- PRE-CONDICOES
--   - replace_my_data existente no estado do schema consolidado.
--
-- COMPATIBILIDADE
--   - Redefinicao aditiva da mesma funcao, mesmo corpo, acrescentando
--     apenas o lock transacional por usuario logo apos a checagem de
--     sessao - o mesmo padrao ja usado por log_security_event.
--   - Chamada unica: comportamento identico. Chamadas concorrentes:
--     serializam (ultimo-escritor-vence, exatamente um payload sobrevive).
--   - Usuarios diferentes nao competem (lock por user_id).
--
-- IMPACTO
--   - Nenhuma tabela, dado, grant ou policy alterado. O lock vive apenas
--     durante a transacao (pg_advisory_xact_lock).
--
-- VERIFICACAO POSTERIOR
--   - Em homologacao, disparar dois restores concorrentes com payloads
--     distintos e conferir que exatamente um payload sobrevive.
--   - Restore unico de regressao: substituicao completa normal.
--
-- RECUPERACAO
--   Migration corretiva posterior redefinindo a funcao sem o lock.
--   Nenhuma etapa destrutiva.
-- =====================================================================

begin;

create or replace function public.replace_my_data(p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); item record;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000'; end if;
  perform pg_advisory_xact_lock(hashtext('replace_my_data:' || u::text));
  if jsonb_typeof(p_data) <> 'object' then raise exception 'backup invalido' using errcode='22023'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_data->'goals','[]'::jsonb)) x(id text,goal_type text,reverse_completed_at timestamptz) where coalesce(x.goal_type,'standard')='reverse' and x.reverse_completed_at is not null and not exists (select 1 from jsonb_to_recordset(coalesce(p_data->'reverseGoalHistory','[]'::jsonb)) h(goal_id text) where h.goal_id=x.id)) then raise exception 'backup de meta reversa concluida sem historico' using errcode='22023'; end if;
  delete from public.transactions where user_id=u; delete from public.budgets where user_id=u; delete from public.goals where user_id=u; delete from public.categories where user_id=u; delete from public.pgbl_plans where user_id=u; delete from public.reverse_goal_retention_settings where user_id=u;
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

revoke all on function public.replace_my_data(jsonb) from public,anon;
grant execute on function public.replace_my_data(jsonb) to authenticated;

commit;
