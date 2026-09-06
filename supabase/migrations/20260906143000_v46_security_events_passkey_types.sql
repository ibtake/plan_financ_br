-- migration: Amplia o check de security_events para os eventos de passkey (criacao e revogacao).
-- =====================================================================
-- Created at (UTC): 2026-09-06 14:30:00
--
-- Pre-conditions:
--   - public.security_events existe com a constraint security_events_type_check
--     enumerando os 15 tipos atuais (schema.sql:237-254).
-- Compatibility:
--   - Ampliar um check IN(...) nunca invalida linha existente nem muda default.
--     O frontend atual so emite tipos ja aceitos; os novos passam a ser aceitos
--     sem obrigar ninguem a envia-los. Login por passkey grava login_success,
--     que ja existe.
-- Recovery:
--   - Para reverter, nova migracao corretiva com o check anterior. Nao ha perda
--     de dados: nenhuma linha usa os tipos novos antes da Fase 3.
-- =====================================================================

begin;

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
    'rate_limited',
    'passkey_registered',
    'passkey_revoked',
    'passkey_revoked_all'
  ));

commit;

-- POST-CHECKS (execute e confira depois do commit):
--
-- select conname, pg_get_constraintdef(oid)
-- from pg_constraint
-- where conrelid = 'public.security_events'::regclass
--   and conname = 'security_events_type_check';
--
-- Confirme que a linha inclui passkey_registered, passkey_revoked e
-- passkey_revoked_all, e que RLS segue ativa:
-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public' and tablename = 'security_events';
