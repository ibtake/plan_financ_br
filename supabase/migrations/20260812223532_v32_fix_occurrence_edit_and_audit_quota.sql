-- =====================================================================
-- Migration: preserve occurrence edits and enforce audit quota
-- Created at (UTC): 2026-08-12 12:00:00
--
-- Pre-conditions:
--   - Previous transactions and security_events migrations are applied.
-- Compatibility:
--   - Existing RPC signatures and authenticated grants remain unchanged.
-- Recovery:
--   - Apply a new corrective migration; no data is deleted or rewritten.
-- =====================================================================

begin;

-- Objetivo: preservar a data/status da serie ao editar ocorrencias e impedir
-- bypass da quota de auditoria por severidade ou detalhes grandes.
-- Pre-condicoes: migrations anteriores de transactions e security_events aplicadas.
-- Compatibilidade: o frontend antigo continua usando as mesmas assinaturas RPC.
-- RLS/grants: RLS nao muda; as funcoes mantem os grants authenticated existentes.
-- Recuperacao: aplicar nova migration corretiva com create or replace/constraint;
-- nao apagar dados nem reverter automaticamente eventos existentes.

alter table public.security_events
  drop constraint if exists security_events_type_check;

alter table public.security_events
  add constraint security_events_type_check
  check (event_type in (
    'login_success',
    'login_failed',
    'logout',
    'signup',
    'mfa_enrolled',
    'mfa_removed',
    'mfa_challenge_success',
    'mfa_challenge_failed',
    'password_reset_requested',
    'password_changed',
    'bulk_delete',
    'data_imported',
    'rls_violation_attempt',
    'suspicious_activity',
    'rate_limited'
  ));

create or replace function public.toggle_paid_occurrence(
  p_transaction_id text,
  p_occurrence_index integer
)
returns public.transactions
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_transaction public.transactions;
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000';
  end if;
  if p_occurrence_index is null or p_occurrence_index < 0 then
    raise exception 'ocorrencia invalida' using errcode = '22023';
  end if;

  select * into v_transaction
  from public.transactions
  where user_id = v_uid and id = p_transaction_id
  for update;

  if not found then
    raise exception 'lancamento nao encontrado' using errcode = 'P0002';
  end if;
  if v_transaction.installments > 1 and p_occurrence_index >= v_transaction.installments then
    raise exception 'ocorrencia fora do parcelamento' using errcode = '22023';
  end if;

  if p_occurrence_index = 0 then
    v_transaction.paid := not v_transaction.paid;
  elsif coalesce(v_transaction.paid_occurrences, '{}'::jsonb) ? p_occurrence_index::text then
    v_transaction.paid_occurrences := v_transaction.paid_occurrences - p_occurrence_index::text;
  else
    v_transaction.paid_occurrences := jsonb_set(
      coalesce(v_transaction.paid_occurrences, '{}'::jsonb),
      array[p_occurrence_index::text],
      'true'::jsonb,
      true
    );
  end if;

  update public.transactions
  set paid = v_transaction.paid,
      paid_occurrences = v_transaction.paid_occurrences
  where user_id = v_uid and id = p_transaction_id
  returning * into v_transaction;

  return v_transaction;
end;
$$;

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
  v_event_count integer;
  v_details jsonb;
begin
  if v_uid is null or not public.is_token_valid() then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select count(*) into v_event_count
  from public.security_events
  where user_id = v_uid
    and created_at > now() - interval '1 hour';

  if v_event_count >= 50 then
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
    coalesce(p_severity, 'info'),
    v_email,
    left(coalesce(p_user_agent, ''), 400),
    v_details
  );

  delete from public.security_events
  where user_id = v_uid
    and created_at < now() - interval '7 days';
end;
$$;

revoke all on function public.toggle_paid_occurrence(text, integer) from public, anon;
grant execute on function public.toggle_paid_occurrence(text, integer) to authenticated;
revoke all on function public.log_security_event(text, text, jsonb, text) from public, anon;
grant execute on function public.log_security_event(text, text, jsonb, text) to authenticated;

commit;
