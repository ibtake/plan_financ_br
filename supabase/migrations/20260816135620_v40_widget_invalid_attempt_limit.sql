-- =====================================================================
-- migration: v40 - SEC-01: contador global de credenciais invalidas + purge
-- =====================================================================
--
-- OBJETIVO
--   Impedir que valores aleatorios de token/refresh/codigo exauram o
--   armazenamento do plano gratuito. A Edge Function passa a validar a
--   credencial ANTES de chamar consume_widget_rate_limit; este contador
--   global e a unica persistencia para tentativas invalidas, com teto
--   de 600 por hora (muito acima do erro legitimo). Inclui purge
--   probabilistico de janelas expiradas ha mais de 2 horas.
--
-- PRE-CONDICOES
--   - Migration v34 (widget_rate_limits) aplicada.
--
-- COMPATIBILIDADE
--   - Somente aditiva: nova RPC + constraint ampliada (nao remove nada).
--   - A versao anterior da Edge Function continua funcionando: ela nao
--     conhece a nova RPC e a constraint aceita todos os valores antigos.
--
-- IMPACTO
--   - RLS/grants: tabela e RPCs continuam inacessiveis a public/anon/
--     authenticated; execucao somente para service_role.
--   - Constraint operation ganha o valor 'invalid' (linha unica, chave
--     fixa derivada de SHA-256, sem colisao possivel com hashes reais).
--   - Nenhum dado existente e alterado ou removido pelo purge de janelas
--     expiradas (linhas de contador, nao dados de usuarios).
--
-- VERIFICACAO POSTERIOR
--   select public.consume_widget_invalid_attempt_limit(); -- allowed = true
--   select * from public.widget_rate_limits where operation = 'invalid';
--
-- RECUPERACAO
--   Migration corretiva posterior pode revogar/remover a RPC e restringir
--   a constraint de volta a ('token','refresh','install'). Nenhuma etapa
--   desta migration e destrutiva.
-- =====================================================================

begin;

alter table public.widget_rate_limits
  drop constraint widget_rate_limits_operation_check;

alter table public.widget_rate_limits
  add constraint widget_rate_limits_operation_check
  check (operation in ('token', 'refresh', 'install', 'invalid'));

create or replace function public.consume_widget_invalid_attempt_limit()
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key constant text := encode(sha256('SEC-01-global-invalid-attempts'::bytea), 'hex');
  v_count integer;
  v_started timestamptz;
  v_limit constant integer := 600;
  v_window_seconds constant integer := 3600;
begin
  -- Contenção de lock: decisao de rate limit nunca pode travar.
  perform set_config('lock_timeout', '2000ms', true);

  -- Purge probabilistico (~1% das chamadas) de janelas mortas. Falha no
  -- purge nunca afeta a decisao de limite.
  begin
    if random() < 0.01 then
      delete from public.widget_rate_limits
      where window_started_at < now() - make_interval(secs => 7200);
    end if;
  exception when others then
    null;
  end;

  insert into public.widget_rate_limits(key_hash, operation, window_started_at, request_count)
  values (v_key, 'invalid', now(), 1)
  on conflict (key_hash, operation) do update set
    window_started_at = case when public.widget_rate_limits.window_started_at < now() - make_interval(secs => v_window_seconds) then now() else public.widget_rate_limits.window_started_at end,
    request_count = case when public.widget_rate_limits.window_started_at < now() - make_interval(secs => v_window_seconds) then 1 else public.widget_rate_limits.request_count + 1 end
  returning request_count, window_started_at into v_count, v_started;

  return query select
    v_count <= v_limit,
    greatest(0, ceil(extract(epoch from (v_started + make_interval(secs => v_window_seconds) - now())))::integer);
end;
$$;

revoke all on function public.consume_widget_invalid_attempt_limit() from public, anon, authenticated;
grant execute on function public.consume_widget_invalid_attempt_limit() to service_role;

commit;
