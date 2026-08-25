-- =====================================================================
-- migration: v45 - force row level security nas tabelas de widget
-- =====================================================================
--
-- OBJETIVO
--   Fechar o achado 3.3 da auditoria (backlog B49): widget_install_codes e
--   widget_tokens sao as duas unicas tabelas do schema com
--   `enable row level security` sem o `force` correspondente - as outras 18
--   tem os dois. Sem `force`, o dono da tabela ignora RLS; a protecao
--   efetiva hoje vem de `revoke all ... from public, anon, authenticated`
--   somado a RLS habilitada sem nenhuma policy (nega tudo por default).
--   Esta migration nao fecha um caminho de acesso alcancavel: ela remove a
--   excecao do schema e devolve a segunda camada de defesa, para que uma
--   policy ou um grant adicionado no futuro nao dependa de o dono ter
--   BYPASSRLS para continuar seguro.
--
-- PRE-CONDICOES
--   - widget_install_codes e widget_tokens existentes com RLS habilitada.
--   - Nenhuma policy nessas duas tabelas (estado atual: zero em ambas).
--
-- COMPATIBILIDADE
--   - `force` afeta apenas o DONO da tabela; roles comuns ja eram barrados
--     pelo revoke all e pela ausencia de policy.
--   - service_role (Edge Functions widget-setup, widget-data e admin-users,
--     os unicos acessos externos as duas tabelas) tem BYPASSRLS no Supabase
--     e nao e afetado.
--   - activate_widget_install_code e rotate_widget_refresh_token sao
--     `security definer` e rodam como o dono. Precedente identico no mesmo
--     banco: widget_rate_limits tem `enable` + `force` + zero policies e e
--     escrita por consume_widget_rate_limit (`security definer`) em toda
--     requisicao do widget; widget_auth_metrics, mesma forma. As duas
--     funcionam em producao hoje, o que confirma que o dono tem BYPASSRLS.
--
-- IMPACTO
--   - Nenhum dado, grant, policy, coluna ou indice alterado. Apenas o flag
--     relforcerowsecurity das duas tabelas.
--
-- VERIFICACAO POSTERIOR
--   - select relname, relrowsecurity, relforcerowsecurity from pg_class
--     where relname in ('widget_install_codes', 'widget_tokens');
--     Esperado: t / t nas duas linhas.
--   - Vincular um widget novo (consome activate_widget_install_code) e
--     forcar um refresh de token (rotate_widget_refresh_token). Sao os dois
--     unicos caminhos que rodam como dono e que `force` poderia afetar.
--
-- RECUPERACAO
--   alter table public.widget_install_codes no force row level security;
--   alter table public.widget_tokens no force row level security;
--   Nenhuma etapa destrutiva.
-- =====================================================================

begin;

alter table public.widget_install_codes force row level security;
alter table public.widget_tokens force row level security;

commit;
