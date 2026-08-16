-- =====================================================================
-- migration: v43 - enforcement server-side da troca inicial de senha
-- =====================================================================
--
-- OBJETIVO
--   Fechar o achado vuln-0003 do pentest de 16/08 (CWE-602): contas
--   provisionadas pelo admin nascem com app_metadata.must_change_password
--   e a exigencia de troca era aplicada SOMENTE pelo frontend
--   (RequiredPasswordScreen). Chamadas diretas a API com a sessao valida
--   mantinham acesso integral e indefinido com a senha temporaria.
--
-- PRE-CONDICOES
--   - is_token_valid() existente (ponto unico de validacao de sessao usado
--     por todas as policies RLS e RPCs authenticated).
--
-- COMPATIBILIDADE
--   - O Supabase copia app_metadata para claim de nivel superior do JWT,
--     com valor serializado como texto; a checagem compara 'true'.
--   - O fluxo de troca (Edge Function admin-users via GoTrue getUser +
--     service_role) NAO passa por is_token_valid e continua funcionando.
--   - Apos concluir a troca, o GoTrue emite token novo sem o flag e o
--     acesso e restaurado imediatamente.
--   - ATT: no momento da aplicacao, qualquer conta com flag pendente perde
--     acesso ao plano de dados ate concluir a troca (comportamento desejado;
--     a tela de troca permanece funcional).
--
-- IMPACTO
--   - Apenas redefinicao aditiva de funcao; nenhuma tabela, dado ou grant
--     e alterado.
--
-- VERIFICACAO POSTERIOR
--   - Sessao com must_change_password=true: SELECT em tabela protegida
--     retorna 0 linhas e RPCs levantam SQLSTATE 28000.
--   - Sessao sem o flag (ou false): comportamento identico ao anterior.
--   - Fluxo completo: criar usuario via admin -> logar -> trocar senha ->
--     acesso normal.
--
-- RECUPERACAO
--   Migration corretiva posterior redefinindo is_token_valid sem a
--   checagem do flag. Nenhuma etapa destrutiva.
-- =====================================================================

begin;

create or replace function public.is_token_valid()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_uid          uuid;
  v_token_iat    bigint;
  v_user_updated timestamptz;
  c_grace        constant bigint := 1;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return false;
  end if;

  -- v43: troca inicial de senha obrigatoria. Enquanto o flag
  -- must_change_password estiver presente no app_metadata do token, a
  -- sessao e invalida para o plano de dados (RLS e RPCs). O valor vem
  -- serializado como texto ('true') no claim JSON.
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'must_change_password', 'false') = 'true' then
    return false;
  end if;

  v_token_iat := coalesce((auth.jwt() ->> 'iat')::bigint, 0);
  if v_token_iat = 0 then
    return false;
  end if;

  select updated_at into v_user_updated
  from auth.users
  where id = v_uid;

  if v_user_updated is null then
    return true;
  end if;

  return v_token_iat + c_grace >= floor(extract(epoch from v_user_updated))::bigint;
end;
$$;

revoke all on function public.is_token_valid() from public, anon;
grant execute on function public.is_token_valid() to authenticated;

commit;
