begin;

-- Migration: SEC-02 restringe RPCs SECURITY DEFINER de Metas Reversas.
-- Objetivo: impedir acesso direto a funcoes internas, neutralizar grants
-- residuais da implementacao antiga e impedir que novas funcoes publicas
-- herdem EXECUTE para anon/authenticated.
-- Pre-condicoes: migrations V13-V17 e V37 aplicadas.
-- Compatibilidade: nao altera as RPCs de negocio usadas pelo frontend nem
-- as RPCs de manutencao chamadas pelas Edge Functions.
-- Impacto: reduz grants diretos; RLS permanece habilitado e forcado.
-- Recuperacao: migration corretiva com grants especificos, se uma dependencia
-- controlada for identificada durante a homologacao.

-- Funcoes internas e a implementacao antiga nao sao pontos de entrada.
revoke all on function public.rebuild_reverse_goal(text)
  from public, anon, authenticated, service_role;
revoke all on function public.rebuild_reverse_goal_for_user(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.refresh_reverse_goal_forecast(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.refresh_reverse_goal_forecast_after_rebuild()
  from public, anon, authenticated, service_role;

-- Somente os jobs server-side entram diretamente nas rotinas de manutencao.
revoke all on function public.rebuild_all_reverse_goals()
  from public, anon, authenticated;
grant execute on function public.rebuild_all_reverse_goals()
  to service_role;

revoke all on function public.cleanup_expired_reverse_goals()
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_reverse_goals()
  to service_role;

-- Novos objetos publicos devem receber grants explicitos, nunca permissao
-- automatica para papeis de cliente.
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- Escrita de dados de Metas Reversas ocorre somente pelas RPCs de negocio.
revoke all on table public.reverse_goal_contributions,
  public.reverse_goal_events,
  public.reverse_goal_history,
  public.reverse_goal_retention_settings
  from anon;
revoke all on table public.reverse_goal_contributions,
  public.reverse_goal_events,
  public.reverse_goal_history,
  public.reverse_goal_retention_settings
  from authenticated;
grant select on table public.reverse_goal_contributions,
  public.reverse_goal_events,
  public.reverse_goal_history,
  public.reverse_goal_retention_settings
  to authenticated;

revoke all on sequence public.reverse_goal_contributions_id_seq,
  public.reverse_goal_events_id_seq,
  public.reverse_goal_history_id_seq
  from anon, authenticated;

commit;
