create or replace function public.log_security_event(
  p_event_type text,
  p_severity   text default 'info',
  p_details    jsonb default '{}'::jsonb,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_event_count integer;
begin
  if v_uid is null then
    return;
  end if;

  select count(*) into v_event_count
  from public.security_events
  where user_id = v_uid
    and created_at > now() - interval '1 hour';

  -- V-04: nunca descartar eventos criticos; cota vale so para info/warning
  if v_event_count >= 50 and coalesce(p_severity, 'info') <> 'critical' then
    -- grava no maximo 1 resumo por hora, em vez de silenciar tudo
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
        jsonb_build_object('reason', 'hourly log quota reached')
      );
    end if;
    return;
  end if;

  select email into v_email from auth.users where id = v_uid;

  insert into public.security_events (
    user_id, event_type, severity, email, user_agent, details
  ) values (
    v_uid,
    p_event_type,
    coalesce(p_severity, 'info'),
    v_email,
    left(coalesce(p_user_agent, ''), 400),
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;