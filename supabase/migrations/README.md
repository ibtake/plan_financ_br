# Migracoes do Supabase

Este diretorio guarda, em ordem, todas as alteracoes incrementais aplicadas a
uma instalacao existente do Planejador Financeiro.

O arquivo `../schema.sql` e usado para a **primeira instalacao**. Nao copie o
schema inteiro para este diretorio e nao o reaplique como substituto de uma
migracao incremental.

## Nome dos arquivos

Use timestamp UTC seguido de uma descricao curta em ingles ou portugues sem
acentos:

```text
YYYYMMDDHHMMSS_descricao.sql
```

Exemplo:

```text
20260805133000_add_transaction_favorite.sql
```

O timestamp deve ser unico e posterior ao da ultima migracao.

### Duplicata historica v21/v22

`20260808023614_v22_add_transaction_form_field_preferences.sql` é uma cópia
idêntica e idempotente de `20260808020107_v21_add_transaction_form_field_preferences.sql`.
A v22 foi mantida no histórico por já estar aplicada; é um no-op deliberado e
não deve ser editada ou removida.

## Regras

1. Uma migracao aplicada e imutavel. Para corrigir, crie outro arquivo.
2. Uma migracao deve ter um unico objetivo e preservar os dados.
3. Use o padrao expandir/migrar/contrair para mudancas incompativeis.
4. Teste primeiro em um projeto Supabase de homologacao.
5. Aplique no banco antes de publicar o frontend que depende da alteracao.
6. Confirme RLS, grants, indices, constraints e dados depois da execucao.
7. Nunca salve credenciais, dumps ou dados reais neste diretorio.

## Criar uma migracao

1. Copie `../templates/migration.sql.example` para este diretorio.
2. Renomeie usando o timestamp UTC e uma descricao.
3. Remova os exemplos e escreva somente a alteracao necessaria.
4. Preencha pre-condicoes, compatibilidade e estrategia de reversao.
5. Teste a migracao sobre uma copia/homologacao que represente producao.
6. Registre a aplicacao conforme o guia
   [`docs/ATUALIZACOES-E-DEPLOY.md`](../../docs/ATUALIZACOES-E-DEPLOY.md).

Valide nomes, timestamps e alertas de operacoes de risco antes de publicar:

```bash
npm run migrations:check
```

Esse comando apenas le os arquivos locais. Ele nao se conecta ao Supabase e nao
executa SQL. Ele tambem cobra o objetivo de cada migracao, aceitando o
cabecalho `-- migration:` no arquivo ou a linha correspondente na tabela
"Indice de objetivos" no fim deste README.

O arquivo de modelo termina em `.example` para nao ser interpretado como uma
migracao executavel por ferramentas automaticas.

## Transacoes

Use `begin`/`commit` quando todas as instrucoes forem transacionais. Algumas
operacoes PostgreSQL podem exigir execucao fora de uma transacao; nesses casos,
documente a razao e uma recuperacao segura no proprio arquivo.

Nao inclua `rollback` no final de uma migracao real: ele desfaria a alteracao.
`rollback` deve ser usado apenas durante testes ou quando uma instrucao falha
antes do `commit`.

## Índice de objetivos

Toda migração precisa ter o objetivo registrado em um dos dois lugares: o
cabeçalho `-- migration:` dentro do `.sql` ou uma entrada nesta tabela. O
`npm run migrations:check` aceita as duas formas e avisa quando faltam as duas.
As migrações anteriores à v19 nasceram sem cabeçalho e já estão aplicadas, logo
são imutáveis: o objetivo delas fica aqui.

| Migração | Objetivo |
| --- | --- |
| `20260806004851_v04_log_rate_limit.sql` | Cria `log_security_event` com limite de 50 eventos por hora por usuário, preservando os de severidade `critical`. |
| `20260806005714_v05_replace_my_data.sql` | Cria `replace_my_data`, a RPC que restaura o backup JSON do usuário em uma transação. |
| `20260806143910_v06_add_reinvested_type.sql` | Aceita o tipo `reinvested` nos checks de `categories` e `transactions`. |
| `20260806144050_v07_add_category_target_percentage.sql` | Adiciona `categories.target_percentage` com padrão 0 e check de 0 a 100. |
| `20260806144203_v08_replace_my_data_target_percentage.sql` | Faz `replace_my_data` restaurar também o `target_percentage` das categorias. |
| `20260806144310_v09_security_events_retention.sql` | Purga eventos de segurança com mais de 7 dias e restringe `log_security_event` a `authenticated`. |
| `20260806144410_v10_default_reinvested_categories.sql` | Cria as categorias padrão de reinvestimento nos usuários existentes e em `handle_new_user`. |
| `20260806162608_v11_add_admin_action_rate_limit.sql` | Cria `admin_action_rate_limits` e `consume_admin_rate_limit`, com janela de 1 minuto por ação de administrador. |
| `20260806211103_v12_secure_data_management_rpcs.sql` | Exige sessão válida e AAL suficiente em `replace_my_data` e cria `delete_my_data`. |
| `20260807002448_v13_add_reverse_goals.sql` | Introduz Metas Reversas: colunas em `goals`, tabelas de Selic, aportes, histórico, eventos e retenção, com RLS e RPCs. |
| `20260807020256_v14_secure_reverse_goals.sql` | Endurece as RPCs de Metas Reversas: rebuild por usuário, grants mínimos e edição de aporte. |
| `20260807032257_v15_reverse_goal_forecast.sql` | Adiciona a previsão da meta reversa (média de aporte e data estimada) com trigger de recálculo. |
| `20260807112928_v16_restore_reverse_goal_backups.sql` | Faz o restore repor aportes, eventos e retenção de metas reversas e reconstruir cada meta. |
| `20260807152808_v17_secure_reverse_goal_restore.sql` | Recusa backup de meta reversa concluída sem histórico e reconstrói apenas as metas em aberto, com o dono passado explicitamente. |
| `20260807163023_v18_confirm_goal_deletion.sql` | Cria `delete_goal`, que valida a sessão e falha quando a meta não existe. |
| `20260807174911_v19_standard_goal_contributions.sql` | Cria o ledger de aportes das metas padrão e converte o saldo agregado existente em um lançamento histórico. |
| `20260807181855_v20_restore_standard_goal_contributions.sql` | Preserva o ledger de aportes das metas padrão durante a restauração de backup. |
| `20260808020107_v21_add_transaction_form_field_preferences.sql` | Adiciona `profiles.transaction_form_fields` com os campos visíveis do formulário e check de objeto JSON. |
| `20260808023614_v22_add_transaction_form_field_preferences.sql` | Cópia idempotente da v21, mantida no histórico por já estar aplicada; veja "Duplicata historica v21/v22". |
| `20260808234941_v23_atomic_reset_my_data.sql` | Cria `reset_my_data_with_defaults`, que apaga os dados e repõe as categorias padrão na mesma transação. |
| `20260810000303_v24_scriptable_widget.sql` | Cria as tabelas do widget Scriptable: códigos de instalação temporários e tokens somente leitura. |
| `20260810031621_v25_atomic_widget_install.sql` | Torna atômico o consumo do código de instalação e garante um único token por código. |
| `20260811104240_v26_reduce_token_grace.sql` | Reduz a tolerância de `is_token_valid` a 1 segundo entre o `iat` do token e o `updated_at` da conta. |
| `20260811104522_v27_fix_log_security_event_rate_limit_race.sql` | Elimina a corrida na contagem do rate limit de auditoria com `pg_advisory_xact_lock` por usuário. |
| `20260811104645_v28_toggle_paid_occurrence_atomic.sql` | Torna `toggle_paid_occurrence` atômico e valida o índice da ocorrência no servidor. |
| `20260811104742_v29_validate_token_in_security_event.sql` | Passa a exigir token válido, e não apenas usuário autenticado, para registrar evento de segurança. |
| `20260811135247_v30_add_pgbl_plans.sql` | Cria `pgbl_plans`, que guarda os planos anuais do Aporte Certo por usuário. |
| `20260811161346_v31_widget_expiry_and_pgbl_lifecycle.sql` | Expira o token do widget em 30 dias, adiciona refresh token e completa o ciclo de vida do PGBL no delete e no restore. |
| `20260812223532_v32_fix_occurrence_edit_and_audit_quota.sql` | Preserva a edição de ocorrência e aplica a cota de auditoria. |
| `20260814023938_v33_atomic_widget_refresh.sql` | Consome o refresh token do widget uma única vez, mesmo sob concorrência. |
| `20260814124106_v34_widget_rate_limit.sql` | Cria `widget_rate_limits` e `consume_widget_rate_limit`, por credencial e operação. |
| `20260815173942_v35_widget_auth_metrics.sql` | Cria as métricas agregadas e amostradas de falha de autenticação do widget. |
| `20260815174044_v36_critical_audit_quota.sql` | Preserva eventos de segurança críticos depois de a cota comum se esgotar. |
| `20260815174149_v37_consolidate_schema_state.sql` | Libera a ação de métricas do widget no admin e preserva o ledger de metas padrão em restore posterior. |
| `20260816012608_v38_sec_02_harden_reverse_goal_permissions.sql` | SEC-02: restringe as RPCs SECURITY DEFINER de Metas Reversas e os privilégios padrão do schema. |
| `20260816021534_v39_sec_03_bound_reverse_goal_rebuild.sql` | SEC-03: limita os valores da meta reversa e isola o rebuild global em `service_role`. |
| `20260816135620_v40_widget_invalid_attempt_limit.sql` | SEC-01: cria o contador global de credenciais inválidas do widget, com purga. |
| `20260816135633_v41_sec02_goals_least_privilege.sql` | SEC-02: least privilege em `public.goals`, com update apenas de nome, ícone e cor, e defaults sem PUBLIC. |
| `20260816135649_v42_admin_password_change_rate_limit.sql` | Aplica rate limit no servidor à troca de senha administrativa. |
| `20260816203813_v43_enforce_must_change_password.sql` | Impõe no servidor a troca inicial de senha (achado vuln-0003 do pentest de 16/08). |
| `20260816203837_v44_fix_replace_my_data_race.sql` | Serializa restores concorrentes do mesmo usuário (achado vuln-0001 do pentest de 16/08). |
| `20260825023357_v45_force_rls_widget_tables.sql` | Aplica `force row level security` nas tabelas do widget. |
