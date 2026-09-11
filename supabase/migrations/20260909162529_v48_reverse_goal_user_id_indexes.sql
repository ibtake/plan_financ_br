begin;

-- =====================================================================
-- v48 - Indices reverse_goal_* liderados por user_id (SUPB-004)
-- =====================================================================
-- As leituras do financeLoader trazem todas as linhas do usuario
-- (selectAllPages, sem filtro de meta) ordenadas por data desc e id desc; o
-- recorte por usuario vem da RLS. Os indices atuais lideram por goal_id, entao
-- o plano varre amplo e reordena, crescendo com o total da base e nao com os
-- dados do proprio usuario. Estes tres indices lideram por user_id e ja
-- entregam a ordem lida, espelhando standard_goal_contributions.
--
-- Expand-only: os indices por goal_id permanecem (servem os acessos por meta,
-- como o delete do rebuild_reverse_goal); removê-los, se a medicao confirmar,
-- fica para uma migracao posterior a homologacao.

create index if not exists reverse_goal_contributions_user_date_idx
  on public.reverse_goal_contributions (user_id, occurred_on desc, id desc);

create index if not exists reverse_goal_history_user_month_idx
  on public.reverse_goal_history (user_id, reference_month desc, id desc);

create index if not exists reverse_goal_events_user_date_idx
  on public.reverse_goal_events (user_id, occurred_on desc, id desc);

commit;
