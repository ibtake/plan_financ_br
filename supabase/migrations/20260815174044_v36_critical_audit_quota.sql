-- =====================================================================
-- Migration: preserve critical security events after the common audit quota
-- Created at (UTC): 2026-08-15 13:00:00
--
-- Objective: keep critical events observable without allowing unlimited logs.
-- Preconditions: previous security_events migrations are applied.
-- Compatibility: the existing log_security_event signature and grants remain.
-- Recovery: apply a new corrective migration; no rows are deleted or rewritten.
-- =====================================================================

create or replace function public.log_security_event(
  p_event_type text,
  p_severity text default 'info',
  p_details jsonb default '{}'::jsonb,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_common_count integer;
  v_critical_count integer;
  v_severity text := lower(coalesce(nullif(trim(p_severity), ''), 'info'));
  v_details jsonb;
begin
  if v_uid is null or not public.is_token_valid() then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select count(*) into v_critical_count
  from public.security_events
  where user_id = v_uid
    and lower(coalesce(severity, 'info')) = 'critical'
    and created_at > now() - interval '1 hour';

  if v_severity = 'critical' and v_critical_count >= 10 then
    return;
  end if;

  select count(*) into v_common_count
  from public.security_events
  where user_id = v_uid
    and lower(coalesce(severity, 'info')) <> 'critical'
    and created_at > now() - interval '1 hour';

  if v_severity <> 'critical' and v_common_count >= 50 then
    if not exists (
      select 1 from public.security_events
      where user_id = v_uid
        and event_type = 'rate_limited'
        and created_at > now() - interval '1 hour'
    ) then
      select email into v_email from auth.users where id = v_uid;
      insert into public.security_events (
        user_id, event_type, severity, email, user_agent, details
      ) values (
        v_uid, 'rate_limited', 'warning', v_email,
        left(coalesce(p_user_agent, ''), 400),
        jsonb_build_object('reason', 'hourly common audit quota reached')
      );
    end if;
    return;
  end if;

  v_details := coalesce(p_details, '{}'::jsonb);
  if octet_length(convert_to(v_details::text, 'utf8')) > 16384 then
    v_details := jsonb_build_object('truncated', true, 'reason', 'details exceeded 16 KiB');
  end if;

  select email into v_email from auth.users where id = v_uid;
  insert into public.security_events (
    user_id, event_type, severity, email, user_agent, details
  ) values (
    v_uid,
    p_event_type,
    v_severity,
    v_email,
    left(coalesce(p_user_agent, ''), 400),
    v_details
  );

  delete from public.security_events
  where user_id = v_uid
    and created_at < now() - interval '7 days';
end;
$$;

revoke all on function public.log_security_event(text, text, jsonb, text) from public, anon;
grant execute on function public.log_security_event(text, text, jsonb, text) to authenticated;
