-- migration: retencao de 7 dias no historico de seguranca
--
-- OBJETIVO
--   Evitar armazenamento indefinido de eventos de seguranca. A funcao
--   log_security_event passa a expurgar, na propria gravacao, os eventos do
--   usuario com mais de 7 dias. Sem pg_cron: o expurgo acontece junto do
--   insert, entao nao ha job externo para manter.
--
-- PRE-CONDICOES
--   - Tabela public.security_events existe.
--   - Funcao log_security_event ja com o rate-limit da V-04 aplicado
--     (20260806004851_v04_log_rate_limit.sql). O corpo abaixo reproduz aquela
--     versao integralmente e apenas acrescenta o delete final.
--
-- COMPATIBILIDADE
--   Retrocompativel. Mesma assinatura, mesmos grants. O frontend nao muda: a
--   aba Seguranca simplesmente deixa de exibir registros antigos.
--   CREATE OR REPLACE preserva os grants existentes.
--
-- IMPACTO EM RLS/GRANTS/INDICES
--   Nenhuma mudanca de RLS ou de grants. O delete e restrito a user_id =
--   auth.uid() e usa o indice security_events_user_created_idx
--   (user_id, created_at desc), entao nao faz varredura da tabela.
--
-- ATENCAO / PERDA DE DADOS
--   A partir da aplicacao, eventos com mais de 7 dias sao removidos
--   permanentemente na primeira gravacao de cada usuario. Isso e intencional e
--   foi solicitado no REQ 8. Se houver necessidade de retencao maior para
--   auditoria, exporte a tabela ANTES de aplicar esta migracao.
--
-- VERIFICACAO POSTERIOR
--   select count(*) from public.security_events
--   where created_at < now() - interval '7 days';
--   Apos um novo evento do usuario, a contagem dele deve zerar.
--
-- RECUPERACAO
--   Nova migracao corretiva recriando a funcao sem o bloco de delete (o corpo
--   da V-04). Registros ja expurgados nao voltam: dependem de backup.

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

  -- V-09 (REQ 8): retencao de 7 dias. Restrito ao proprio usuario e apoiado
  -- no indice (user_id, created_at desc).
  delete from public.security_events
  where user_id = v_uid
    and created_at < now() - interval '7 days';
end;
$$;

revoke all on function public.log_security_event(text, text, jsonb, text) from public;
revoke all on function public.log_security_event(text, text, jsonb, text) from anon;
grant execute on function public.log_security_event(text, text, jsonb, text) to authenticated;
