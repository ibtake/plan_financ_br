-- =====================================================================
-- migration: v50 - AUDT-001: contador de tentativas invalidas por IP
-- =====================================================================
--
-- OBJETIVO
--   O contador de credenciais invalidas do widget-data (v40) usa uma
--   chave global constante: um unico IP em loop de POST sem credencial
--   esgota o teto de 600/h e o endpoint passa a negar tentativas
--   invalidas para todos ate a janela virar (ponto unico de
--   disponibilidade). Passa a chavear por hash do IP de origem: um
--   atacante so consome o proprio balde; os demais seguem atendidos.
--
--   A Edge Function deriva o hash de `cf-connecting-ip` (setado pela
--   borda Cloudflare da plataforma, nao spoofavel pelo cliente porque a
--   funcao so e alcancavel via CF). O `x-forwarded-for` (leftmost) e
--   spoofavel e NAO e usado. Sem o header (cenario degradado), a Edge
--   Function omite o parametro e cai no balde global de 600/h - o
--   comportamento anterior, nunca pior.
--
-- PRE-CONDICOES
--   - Migration v40 (consume_widget_invalid_attempt_limit) aplicada.
--
-- COMPATIBILIDADE
--   - A assinatura antiga sem argumentos e substituida por uma com
--     `p_key_hash text default null`. Chamador que invoca sem argumento
--     (Edge Function anterior a este deploy) resolve para o parametro
--     default null -> chave global -> mesmo comportamento de antes. Nao
--     ha janela de quebra entre aplicar a migration e redeployar a
--     funcao.
--   - Nenhuma mudanca de schema/constraint: as linhas por IP usam a
--     mesma coluna key_hash (SHA-256 hex, mesmo formato da chave global)
--     e operation = 'invalid'; o unique (key_hash, operation) ja
--     acomoda multiplas chaves.
--
-- IMPACTO
--   - RLS/grants: execucao somente para service_role, como na v40.
--   - Teto por IP presente: 60/h (um IP legitimo nunca chama invalidas
--     nesse volume). Fallback sem IP: 600/h global, identico a v40.
--   - Armazenamento: passa a existir uma linha por IP/janela em vez de
--     uma unica global. Limitado pelo purge probabilistico de janelas
--     > 7200s (inalterado). O gate Redis per-IP da Edge Function absorve
--     o excesso antes do Postgres no caminho normal.
--
-- VERIFICACAO POSTERIOR
--   select public.consume_widget_invalid_attempt_limit();          -- global, allowed = true
--   select public.consume_widget_invalid_attempt_limit('abc123');  -- por chave, allowed = true
--   select key_hash, operation, request_count from public.widget_rate_limits where operation = 'invalid';
--
-- RECUPERACAO
--   Migration corretiva pode restaurar a assinatura sem argumento da
--   v40. Nenhuma etapa desta migration e destrutiva de dados de usuario.
-- =====================================================================

begin;

-- A v40 criou a funcao sem argumentos. Removo essa assinatura para que a
-- nova (com default) atenda tanto chamadas com quanto sem parametro sem
-- ambiguidade de overload.
drop function if exists public.consume_widget_invalid_attempt_limit();

create or replace function public.consume_widget_invalid_attempt_limit(p_key_hash text default null)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- Chave por IP quando fornecida; senao a chave global constante da v40.
  v_scoped constant boolean := nullif(btrim(coalesce(p_key_hash, '')), '') is not null;
  v_key constant text := case
    when v_scoped then btrim(p_key_hash)
    else encode(sha256('SEC-01-global-invalid-attempts'::bytea), 'hex')
  end;
  v_count integer;
  v_started timestamptz;
  -- Por IP: 60/h aperta o abuso individual. Global (fallback sem IP):
  -- 600/h, identico a v40 - nunca pior que o comportamento anterior.
  v_limit constant integer := case when v_scoped then 60 else 600 end;
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

revoke all on function public.consume_widget_invalid_attempt_limit(text) from public, anon, authenticated;
grant execute on function public.consume_widget_invalid_attempt_limit(text) to service_role;

commit;
