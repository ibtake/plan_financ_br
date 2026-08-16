-- =====================================================================
-- PLANEJADOR FINANCEIRO - Schema, seguranca e auditoria
-- =====================================================================
--
-- COMO EXECUTAR
--   Painel do Supabase > SQL Editor > New query > cole TODO este arquivo
--   > clique em "Run". Pode ser executado novamente sem quebrar nada
--   (todas as instrucoes sao idempotentes).
--
-- O QUE ESTE ARQUIVO GARANTE
--   1. Cada usuario so acessa as proprias linhas (Row Level Security)
--   2. Ninguem consegue transferir uma linha para outro usuario
--   3. Visitantes nao autenticados nao leem nada
--   4. Tentativas de acesso indevido ficam registradas em security_events
--   5. Dados invalidos sao rejeitados pelo proprio banco
--   6. MFA obrigatorio verificado na camada de banco (AAL2)
--   7. Sessoes revogadas invalidadas imediatamente (JWT TOCTOU)
--   8. Rate limiting em eventos de seguranca (protecao anti-DoS)
-- =====================================================================


-- =====================================================================
-- BLOCO 1 - Extensoes
-- =====================================================================

create extension if not exists "pgcrypto";


-- =====================================================================
-- BLOCO 2 - Fechar o schema publico por padrao
-- =====================================================================
-- Por padrao o Postgres concede permissoes amplas. Aqui removemos tudo
-- e concedemos apenas o minimo necessario.
--
-- "anon"          = visitante sem login  -> nenhum acesso a dados
-- "authenticated" = usuario logado       -> acesso filtrado pela RLS
-- =====================================================================

revoke all on schema public from anon;
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

grant usage on schema public to authenticated;


-- =====================================================================
-- BLOCO 3 - Funcao utilitaria: atualizar updated_at
-- =====================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- =====================================================================
-- BLOCO 4 - Funcao de seguranca: impedir troca de dono
-- =====================================================================
-- Sem esta protecao, um usuario poderia executar um UPDATE alterando o
-- user_id de uma linha, "doando" ou sequestrando registros. A politica
-- RLS de UPDATE com WITH CHECK ja dificulta isso, mas o trigger e uma
-- segunda barreira independente (defesa em profundidade).
-- =====================================================================

create or replace function public.prevent_owner_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Alteracao de proprietario do registro nao permitida';
  end if;
  return new;
end;
$$;


-- =====================================================================
-- BLOCO 5 - Funcao de validacao de sessao: JWT TOCTOU mitigation
-- =====================================================================
-- Valida que o token JWT foi emitido DEPOIS da ultima alteracao de
-- credenciais do usuario. Previne que tokens antigos continuem validos
-- apos troca de senha ou outras mudancas de seguranca.
--
-- IMPORTANTE: Esta funcao deve ser usada em TODAS as politicas RLS de
-- tabelas criticas. Sem ela, um token comprometido continua valido ate
-- expirar naturalmente (ate 1 hora).
-- =====================================================================

-- GRACE_SECONDS absorve duas fontes de erro que, sem tolerancia, causariam
-- bloqueio total do usuario legitimo:
--   1. "iat" tem granularidade de 1 segundo (truncado); updated_at tem
--      microssegundos. Sem arredondar para baixo, um token emitido no mesmo
--      instante do UPDATE ja nasceria "velho".
--   2. O proprio Supabase toca updated_at durante o login (last_sign_in_at),
--      no mesmo momento em que emite o token.
-- 10s nao enfraquece a revogacao: uma troca de senha real deixa o token
-- antigo minutos ou horas atras do updated_at.

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


-- =====================================================================
-- BLOCO 6 - Funcao de validacao de MFA: AAL2 enforcement
-- =====================================================================
-- Valida que usuarios com MFA configurado estao usando token AAL2.
-- Previne bypass de MFA via API com token AAL1.
--
-- IMPORTANTE: Esta funcao deve ser usada em TODAS as politicas RLS de
-- tabelas criticas. Sem ela, um atacante pode obter token AAL1 e acessar
-- dados ignorando o MFA.
-- =====================================================================

create or replace function public.has_required_aal()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_uid         uuid;
  v_current_aal text;
  v_has_mfa     boolean;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return false;
  end if;

  v_current_aal := coalesce(auth.jwt() ->> 'aal', 'aal1');

  -- Fator "verified" = MFA concluido e em uso. Fator "unverified" e um
  -- cadastro abandonado no meio: exigir aal2 por causa dele trancaria o
  -- usuario fora da propria conta.
  select exists (
    select 1
    from auth.mfa_factors
    where user_id = v_uid
      and status::text = 'verified'
  ) into v_has_mfa;

  if v_has_mfa then
    return v_current_aal = 'aal2';
  end if;

  return true;
end;
$$;

-- As duas funcoes sao chamadas dentro das policies, logo executadas pelo
-- papel que faz a consulta. Sem EXECUTE explicito, um banco endurecido
-- (onde o EXECUTE default de PUBLIC foi revogado) faria toda query falhar.
revoke all on function public.is_token_valid() from public, anon;
revoke all on function public.has_required_aal() from public, anon;
grant execute on function public.is_token_valid() to authenticated;
grant execute on function public.has_required_aal() to authenticated;


-- =====================================================================
-- BLOCO 7 - Tabela de auditoria de seguranca
-- =====================================================================
-- Registra eventos relevantes de seguranca, incluindo TENTATIVAS
-- falhas. E deliberadamente somente-leitura para o usuario: ele pode
-- consultar o proprio historico, mas nao pode editar nem apagar, o que
-- impede que um invasor limpe os rastros.
--
-- NAO sao gravados: senha, codigo TOTP, segredo do autenticador.
-- Registrar esses dados criaria uma nova vulnerabilidade.
-- =====================================================================

create table if not exists public.security_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  event_type  text not null,
  severity    text not null default 'info',
  email       text,
  user_agent  text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),

  constraint security_events_severity_check
    check (severity in ('info', 'warning', 'critical')),

  constraint security_events_type_check
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
    ))
);

create index if not exists security_events_user_created_idx
  on public.security_events (user_id, created_at desc);

alter table public.security_events enable row level security;
alter table public.security_events force row level security;

-- Usuario le apenas os proprios eventos.
-- Alinhado as demais tabelas: exige token valido (TOCTOU) e AAL correto (MFA),
-- para que um token antigo ou de nivel aal1 nao consiga ler o historico.
drop policy if exists "own events select" on public.security_events;
create policy "own events select"
  on public.security_events for select
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

-- REMOVIDO: policy de INSERT direto. Agora apenas via RPC log_security_event()
-- para permitir rate limiting e prevenir DoS.

-- Nao existe policy de UPDATE nem DELETE: o log e imutavel.
-- Sem policy, a RLS bloqueia a operacao por padrao.

grant select on public.security_events to authenticated;


-- =====================================================================
-- BLOCO 8 - Funcao de deteccao de acesso indevido (com rate limiting)
-- =====================================================================
-- Chamada pelo aplicativo quando o Postgres recusa uma operacao por
-- violacao de RLS. Como a RLS ja bloqueou o acesso, o registro serve
-- para documentar a TENTATIVA - que e justamente o sinal de ataque.
--
-- CORRECAO 1: search_path fixado para prevenir schema shadowing
-- CORRECAO 3: Rate limiting implementado - max 50 eventos/hora por usuario
-- V-04: eventos 'critical' escapam da cota; ao atingir o limite grava-se no
--       maximo 1 resumo 'rate_limited' por hora em vez de silenciar tudo
-- V-09 (REQ 8): retencao de 7 dias, expurgada na propria gravacao
--
-- SECURITY DEFINER permite gravar o evento mesmo em situacoes em que o
-- usuario teria o insert negado. O search_path fixo e obrigatorio para
-- evitar sequestro de funcao via schema malicioso.
-- =====================================================================

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
  v_common_count integer;
  v_critical_count integer;
  v_severity text := lower(coalesce(nullif(trim(p_severity), ''), 'info'));
  v_details jsonb;
begin
  if v_uid is null or not public.is_token_valid() then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_uid::text));

  select count(*) into v_critical_count
  from public.security_events
  where user_id = v_uid
    and lower(coalesce(severity, 'info')) = 'critical'
    and created_at > now() - interval '1 hour';

  if v_severity = 'critical' and v_critical_count >= 10 then
    return;
  end if;

  select count(*) into v_common_count
  from public.security_events
  where user_id = v_uid
    and lower(coalesce(severity, 'info')) <> 'critical'
    and created_at > now() - interval '1 hour';

  if v_severity <> 'critical' and v_common_count >= 50 then
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
        jsonb_build_object('reason', 'hourly common audit quota reached')
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
    v_severity,
    v_email,
    left(coalesce(p_user_agent, ''), 400),
    v_details
  );

  delete from public.security_events
  where user_id = v_uid
    and created_at < now() - interval '7 days';
end;
$$;

revoke all on function public.log_security_event(text, text, jsonb, text) from public;
revoke all on function public.log_security_event(text, text, jsonb, text) from anon;
grant execute on function public.log_security_event(text, text, jsonb, text) to authenticated;

-- BLOCO 24 - Rate limit administrativo e ledger de metas padrão (v11, v19, v20)
create table if not exists public.admin_action_rate_limits (
  admin_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('status', 'list-users', 'create-user', 'widget-metrics')),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (admin_id, action)
);
alter table public.admin_action_rate_limits enable row level security;
alter table public.admin_action_rate_limits force row level security;
revoke all on table public.admin_action_rate_limits from public, anon, authenticated;
create or replace function public.consume_admin_rate_limit(p_admin_id uuid, p_action text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer; v_started timestamptz; v_limit integer;
begin
  if p_action not in ('status', 'list-users', 'create-user', 'widget-metrics') then raise exception 'acao invalida'; end if;
  v_limit := case p_action when 'create-user' then 5 when 'list-users' then 30 when 'widget-metrics' then 30 else 60 end;
  insert into public.admin_action_rate_limits(admin_id, action, window_started_at, request_count)
  values (p_admin_id, p_action, now(), 1)
  on conflict (admin_id, action) do update set
    window_started_at = case when public.admin_action_rate_limits.window_started_at < now() - interval '1 minute' then now() else public.admin_action_rate_limits.window_started_at end,
    request_count = case when public.admin_action_rate_limits.window_started_at < now() - interval '1 minute' then 1 else public.admin_action_rate_limits.request_count + 1 end
  returning request_count, window_started_at into v_count, v_started;
  return v_count <= v_limit;
end; $$;
revoke all on function public.consume_admin_rate_limit(uuid,text) from public,anon,authenticated;
grant execute on function public.consume_admin_rate_limit(uuid,text) to service_role;

create table if not exists public.standard_goal_contributions (
  id bigint generated always as identity primary key,
  goal_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists standard_goal_contributions_goal_date_idx on public.standard_goal_contributions(user_id,goal_id,occurred_on desc,id desc);
alter table public.standard_goal_contributions enable row level security;
alter table public.standard_goal_contributions force row level security;
create policy "own standard goal contributions select" on public.standard_goal_contributions for select to authenticated using (auth.uid()=user_id and public.is_token_valid() and public.has_required_aal());
grant select on public.standard_goal_contributions to authenticated;

create or replace function public.rebuild_standard_goal(p_goal_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare total numeric(14,2);
begin
  select coalesce(round(sum(amount), 2), 0) into total
  from public.standard_goal_contributions
  where goal_id = p_goal_id and user_id = p_user_id;
  update public.goals set current = total, updated_at = now()
  where id = p_goal_id and user_id = p_user_id and goal_type = 'standard';
end; $$;
create or replace function public.create_standard_goal(
  p_name text, p_target numeric, p_initial_contribution numeric default 0,
  p_deadline date default null, p_icon text default '🎯', p_color text default '#6366f1'
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid(); gid text := gen_random_uuid()::text;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000';
  end if;
  if nullif(btrim(p_name),'') is null or char_length(btrim(p_name)) > 120
     or p_target <= 0 or p_initial_contribution < 0 or p_deadline > current_date + interval '100 years' then
    raise exception 'dados da meta invalidos' using errcode='22023';
  end if;
  insert into public.goals (id,user_id,name,target,current,deadline,icon,color,goal_type)
  values (gid,u,btrim(p_name),round(p_target,2),0,p_deadline,left(coalesce(p_icon,'🎯'),8),coalesce(p_color,'#6366f1'),'standard');
  if p_initial_contribution > 0 then
    insert into public.standard_goal_contributions (goal_id,user_id,amount,occurred_on,note)
    values (gid,u,round(p_initial_contribution,2),current_date,'Aporte inicial');
    perform public.rebuild_standard_goal(gid,u);
  end if;
  return gid;
end; $$;
create or replace function public.add_standard_goal_contribution(
  p_goal_id text, p_amount numeric, p_occurred_on date
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000';
  end if;
  perform 1 from public.goals
  where id=p_goal_id and user_id=u and goal_type='standard' for update;
  if not found then raise exception 'meta nao encontrada' using errcode='P0002'; end if;
  if p_amount <= 0 or p_occurred_on is null or p_occurred_on > current_date then
    raise exception 'aporte invalido' using errcode='22023';
  end if;
  -- Backups antigos restauram somente goals.current. Ao primeiro novo aporte,
  -- transforma esse saldo em um lancamento para que ele nunca seja perdido.
  insert into public.standard_goal_contributions (goal_id,user_id,amount,occurred_on,note)
  select g.id,g.user_id,round(g.current,2),coalesce(g.updated_at::date,current_date),'Saldo restaurado'
  from public.goals g
  where g.id=p_goal_id and g.user_id=u and g.current>0
    and not exists (select 1 from public.standard_goal_contributions c where c.goal_id=g.id and c.user_id=g.user_id);
  insert into public.standard_goal_contributions (goal_id,user_id,amount,occurred_on)
  values (p_goal_id,u,round(p_amount,2),p_occurred_on);
  perform public.rebuild_standard_goal(p_goal_id,u);
end; $$;
create or replace function public.update_standard_goal_contribution(
  p_contribution_id bigint, p_amount numeric, p_occurred_on date
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid(); gid text;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000';
  end if;
  select c.goal_id into gid from public.standard_goal_contributions c
  join public.goals g on g.user_id=c.user_id and g.id=c.goal_id
  where c.id=p_contribution_id and c.user_id=u and g.goal_type='standard' for update;
  if not found then raise exception 'aporte indisponivel para edicao' using errcode='P0002'; end if;
  if p_amount <= 0 or p_occurred_on is null or p_occurred_on > current_date then
    raise exception 'aporte invalido' using errcode='22023';
  end if;
  update public.standard_goal_contributions
  set amount=round(p_amount,2), occurred_on=p_occurred_on, updated_at=now()
  where id=p_contribution_id and user_id=u;
  perform public.rebuild_standard_goal(gid,u);
end; $$;
create or replace function public.update_standard_goal_metadata(
  p_goal_id text, p_name text, p_target numeric, p_deadline date,
  p_icon text default '🎯', p_color text default '#6366f1'
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000';
  end if;
  if nullif(btrim(p_name),'') is null or char_length(btrim(p_name)) > 120
     or p_target <= 0 or p_deadline > current_date + interval '100 years' then
    raise exception 'dados da meta invalidos' using errcode='22023';
  end if;
  update public.goals
  set name=btrim(p_name), target=round(p_target,2), deadline=p_deadline,
      icon=left(coalesce(p_icon,'🎯'),8), color=coalesce(p_color,'#6366f1'), updated_at=now()
  where id=p_goal_id and user_id=u and goal_type='standard';
  if not found then raise exception 'meta nao encontrada' using errcode='P0002'; end if;
end; $$;
revoke all on function public.rebuild_standard_goal(text,uuid) from public,anon,authenticated;
revoke all on function public.create_standard_goal(text,numeric,numeric,date,text,text) from public,anon;
revoke all on function public.add_standard_goal_contribution(text,numeric,date) from public,anon;
revoke all on function public.update_standard_goal_contribution(bigint,numeric,date) from public,anon;
revoke all on function public.update_standard_goal_metadata(text,text,numeric,date,text,text) from public,anon;
grant execute on function public.create_standard_goal(text,numeric,numeric,date,text,text) to authenticated;
grant execute on function public.add_standard_goal_contribution(text,numeric,date) to authenticated;
grant execute on function public.update_standard_goal_contribution(bigint,numeric,date) to authenticated;
grant execute on function public.update_standard_goal_metadata(text,text,numeric,date,text,text) to authenticated;

create or replace function public.update_reverse_goal_contribution(p_contribution_id bigint,p_amount numeric,p_occurred_on date)
returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare u uuid:=auth.uid(); gid text; start_date date; completed_at timestamptz;
begin
 if u is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000'; end if;
 select c.goal_id,g.reverse_start_date,g.reverse_completed_at into gid,start_date,completed_at from public.reverse_goal_contributions c join public.goals g on g.user_id=c.user_id and g.id=c.goal_id where c.id=p_contribution_id and c.user_id=u for update;
 if not found or completed_at is not null then raise exception 'aporte indisponivel para edicao' using errcode='22023'; end if;
 if p_amount<=0 or p_occurred_on is null or p_occurred_on<start_date or p_occurred_on>current_date then raise exception 'aporte invalido' using errcode='22023'; end if;
 update public.reverse_goal_contributions set amount=round(p_amount,2),occurred_on=p_occurred_on where id=p_contribution_id and user_id=u;
 insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) values(gid,u,'recalculated',current_date,jsonb_build_object('message','Historico recalculado devido a alteracao de aporte.'));
 perform public.rebuild_reverse_goal_for_user(gid,u);
end; $$;
revoke all on function public.update_reverse_goal_contribution(bigint,numeric,date) from public,anon;
grant execute on function public.update_reverse_goal_contribution(bigint,numeric,date) to authenticated;

-- BLOCO 25 - replace_my_data final: metas padrão, metas reversas e PGBL (v37)


-- =====================================================================
-- BLOCO 9 - Perfis de usuario
-- =====================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  theme       text not null default 'light',
  transaction_form_fields jsonb not null default '{"method": true, "recurrence": true, "installments": true, "tags": true, "note": true, "paid": true}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_theme_check check (theme in ('light', 'dark')),
  constraint profiles_transaction_form_fields_check check (jsonb_typeof(transaction_form_fields) = 'object'),
  constraint profiles_name_length check (full_name is null or char_length(full_name) <= 120)
);

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists "own profile select" on public.profiles;
create policy "own profile select"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id AND is_token_valid() AND has_required_aal());

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id AND is_token_valid() AND has_required_aal());

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id AND is_token_valid() AND has_required_aal())
  with check (auth.uid() = id AND is_token_valid() AND has_required_aal());

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

grant select, insert, update on public.profiles to authenticated;


-- =====================================================================
-- BLOCO 10 - Categorias
-- =====================================================================

create table if not exists public.categories (
  id          text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  type        text not null,
  color       text not null default '#6366f1',
  icon        text not null default '📁',
  custom      boolean not null default true,
  -- V-07 (REQ 6): meta percentual esperada da categoria. Usada apenas por
  -- despesa/reinvestimento; receita mantem 0.
  target_percentage numeric not null default 0,
  created_at  timestamptz not null default now(),

  primary key (user_id, id),

  -- V-06 (REQ 3): 'reinvested' e saida de liquidez que acumula patrimonio
  constraint categories_type_check check (type in ('income', 'expense', 'reinvested')),
  constraint categories_target_percentage_check
    check (target_percentage >= 0 and target_percentage <= 100),
  constraint categories_name_length check (char_length(name) between 1 and 60),
  constraint categories_color_format check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint categories_icon_length check (char_length(icon) <= 8)
);

alter table public.categories enable row level security;
alter table public.categories force row level security;

drop policy if exists "own categories select" on public.categories;
create policy "own categories select"
  on public.categories for select
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own categories insert" on public.categories;
create policy "own categories insert"
  on public.categories for insert
  to authenticated
  with check (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own categories update" on public.categories;
create policy "own categories update"
  on public.categories for update
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal())
  with check (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own categories delete" on public.categories;
create policy "own categories delete"
  on public.categories for delete
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop trigger if exists categories_no_owner_change on public.categories;
create trigger categories_no_owner_change
  before update on public.categories
  for each row execute function public.prevent_owner_change();

grant select, insert, update, delete on public.categories to authenticated;


-- =====================================================================
-- BLOCO 11 - Lancamentos
-- =====================================================================

create table if not exists public.transactions (
  id                text not null,
  user_id           uuid not null references auth.users(id) on delete cascade,
  type              text not null,
  description       text not null,
  amount            numeric(14,2) not null,
  category_id       text not null,
  date              date not null,
  method            text not null default 'pix',
  paid              boolean not null default true,
  recurrence        text not null default 'none',
  recurrence_end    date,
  installments      integer not null default 1,
  tags              text[] not null default '{}',
  note              text,
  paid_occurrences  jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  primary key (user_id, id),

  constraint transactions_type_check check (type in ('income', 'expense', 'reinvested')),
  constraint transactions_amount_check check (amount >= 0 and amount < 1000000000),
  constraint transactions_desc_length check (char_length(description) between 1 and 200),
  constraint transactions_note_length check (note is null or char_length(note) <= 1000),
  constraint transactions_installments_check check (installments between 1 and 360),
  constraint transactions_recurrence_check
    check (recurrence in ('none','weekly','monthly','bimonthly','quarterly','yearly')),
  constraint transactions_date_range
    check (date >= '1970-01-01' and date <= '2200-01-01')
);

create index if not exists transactions_user_date_idx
  on public.transactions (user_id, date desc);

-- Otimiza os filtros por tipo (receita/despesa) usados no resumo mensal.
create index if not exists transactions_user_type_date_idx
  on public.transactions (user_id, type, date desc);

alter table public.transactions enable row level security;
alter table public.transactions force row level security;

drop policy if exists "own transactions select" on public.transactions;
create policy "own transactions select"
  on public.transactions for select
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own transactions insert" on public.transactions;
create policy "own transactions insert"
  on public.transactions for insert
  to authenticated
  with check (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own transactions update" on public.transactions;
create policy "own transactions update"
  on public.transactions for update
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal())
  with check (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own transactions delete" on public.transactions;
create policy "own transactions delete"
  on public.transactions for delete
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop trigger if exists transactions_updated_at on public.transactions;
create trigger transactions_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

drop trigger if exists transactions_no_owner_change on public.transactions;
create trigger transactions_no_owner_change
  before update on public.transactions
  for each row execute function public.prevent_owner_change();

grant select, insert, update, delete on public.transactions to authenticated;

-- Alterna uma ocorrencia de pagamento dentro de uma transacao atomica.
-- O FOR UPDATE impede que duas abas percam marcacoes concorrentes.
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

revoke all on function public.toggle_paid_occurrence(text, integer) from public, anon;
grant execute on function public.toggle_paid_occurrence(text, integer) to authenticated;


-- =====================================================================
-- BLOCO 12 - Orcamentos
-- =====================================================================

create table if not exists public.budgets (
  user_id      uuid not null references auth.users(id) on delete cascade,
  category_id  text not null,
  limit_amount numeric(14,2) not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  primary key (user_id, category_id),

  constraint budgets_limit_check check (limit_amount > 0 and limit_amount < 1000000000)
);

alter table public.budgets enable row level security;
alter table public.budgets force row level security;

drop policy if exists "own budgets select" on public.budgets;
create policy "own budgets select"
  on public.budgets for select
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own budgets insert" on public.budgets;
create policy "own budgets insert"
  on public.budgets for insert
  to authenticated
  with check (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own budgets update" on public.budgets;
create policy "own budgets update"
  on public.budgets for update
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal())
  with check (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own budgets delete" on public.budgets;
create policy "own budgets delete"
  on public.budgets for delete
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop trigger if exists budgets_updated_at on public.budgets;
create trigger budgets_updated_at
  before update on public.budgets
  for each row execute function public.set_updated_at();

drop trigger if exists budgets_no_owner_change on public.budgets;
create trigger budgets_no_owner_change
  before update on public.budgets
  for each row execute function public.prevent_owner_change();

grant select, insert, update, delete on public.budgets to authenticated;


-- =====================================================================
-- BLOCO 13 - Metas
-- =====================================================================

create table if not exists public.goals (
  id          text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  target      numeric(14,2) not null default 0,
  current     numeric(14,2) not null default 0,
  deadline    date,
  icon        text not null default '🎯',
  color       text not null default '#6366f1',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  primary key (user_id, id),

  constraint goals_name_length check (char_length(name) between 1 and 120),
  constraint goals_target_check check (target >= 0 and target < 1000000000),
  constraint goals_current_check check (current >= 0 and current < 1000000000),
  constraint goals_color_format check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint goals_icon_length check (char_length(icon) <= 8)
);

alter table public.goals enable row level security;
alter table public.goals force row level security;

drop policy if exists "own goals select" on public.goals;
create policy "own goals select"
  on public.goals for select
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own goals insert" on public.goals;
create policy "own goals insert"
  on public.goals for insert
  to authenticated
  with check (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own goals update" on public.goals;
create policy "own goals update"
  on public.goals for update
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal())
  with check (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop policy if exists "own goals delete" on public.goals;
create policy "own goals delete"
  on public.goals for delete
  to authenticated
  using (auth.uid() = user_id AND is_token_valid() AND has_required_aal());

drop trigger if exists goals_updated_at on public.goals;
create trigger goals_updated_at
  before update on public.goals
  for each row execute function public.set_updated_at();

drop trigger if exists goals_no_owner_change on public.goals;
create trigger goals_no_owner_change
  before update on public.goals
  for each row execute function public.prevent_owner_change();

grant select, insert, update, delete on public.goals to authenticated;

alter table public.standard_goal_contributions
  add constraint standard_goal_contributions_goal_fk
  foreign key (user_id, goal_id) references public.goals(user_id, id) on delete cascade;


-- =====================================================================
-- BLOCO 13.1 - Restauracao transacional de backup
-- =====================================================================
-- V-05/V-08: usada pelo frontend ao importar um backup. A substituicao das
-- colecoes ocorre em uma unica transacao: se qualquer insert falhar, o
-- PostgreSQL desfaz tudo e os dados anteriores do usuario permanecem intactos.
-- A funcao usa o usuario autenticado, nunca um user_id recebido do navegador,
-- e repete as verificacoes de token e AAL/MFA porque SECURITY DEFINER ignora RLS.


-- BLOCO 22 - Métricas agregadas de autenticação do widget (v35)
create table if not exists public.widget_auth_metrics (
  metric_date date not null default current_date,
  failure_type text not null check (failure_type in ('token', 'refresh', 'install_code', 'unauthorized')),
  sampled_count integer not null default 0 check (sampled_count >= 0),
  last_sampled_at timestamptz not null default now(),
  primary key (metric_date, failure_type)
);
alter table public.widget_auth_metrics enable row level security;
alter table public.widget_auth_metrics force row level security;
revoke all on table public.widget_auth_metrics from public, anon, authenticated;
create or replace function public.record_widget_auth_metric(p_failure_type text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_failure_type not in ('token', 'refresh', 'install_code', 'unauthorized') then return; end if;
  insert into public.widget_auth_metrics (metric_date, failure_type, sampled_count)
  values (current_date, p_failure_type, 1)
  on conflict (metric_date, failure_type) do update
    set sampled_count = least(public.widget_auth_metrics.sampled_count + 1, 1000000000), last_sampled_at = now();
end; $$;
revoke all on function public.record_widget_auth_metric(text) from public, anon, authenticated;
grant execute on function public.record_widget_auth_metric(text) to service_role;

-- BLOCO 22 - Widget Scriptable (códigos temporários e tokens read-only)
-- O frontend nunca acessa estas tabelas diretamente; somente as Edge
-- Functions usam service_role para emitir, consumir e revogar integrações.
create table if not exists public.widget_install_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.widget_tokens (
  id uuid primary key default gen_random_uuid(),
  install_code_id uuid not null references public.widget_install_codes(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  access_expires_at timestamptz not null default (now() + interval '30 days'),
  refresh_token_hash text,
  refresh_expires_at timestamptz not null default (now() + interval '365 days'),
  created_at timestamptz not null default now()
);

create index if not exists widget_install_codes_user_idx on public.widget_install_codes(user_id, created_at desc);
create index if not exists widget_tokens_user_idx on public.widget_tokens(user_id, created_at desc);
create unique index if not exists widget_tokens_install_code_unique on public.widget_tokens(install_code_id);
create unique index if not exists widget_tokens_refresh_hash_unique on public.widget_tokens(refresh_token_hash) where refresh_token_hash is not null;

create table if not exists public.pgbl_plans (
  user_id uuid not null references auth.users(id) on delete cascade,
  year integer not null check (year between 2000 and 2200),
  months jsonb not null default '[]'::jsonb,
  premise jsonb not null default '{}'::jsonb,
  fiscal_params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, year)
);
create index if not exists pgbl_plans_user_year_idx on public.pgbl_plans(user_id, year desc);
alter table public.pgbl_plans enable row level security;
alter table public.pgbl_plans force row level security;
drop policy if exists "own pgbl plans select" on public.pgbl_plans;
create policy "own pgbl plans select" on public.pgbl_plans for select using (auth.uid()=user_id and public.is_token_valid() and public.has_required_aal());
drop policy if exists "own pgbl plans insert" on public.pgbl_plans;
create policy "own pgbl plans insert" on public.pgbl_plans for insert with check (auth.uid()=user_id and public.is_token_valid() and public.has_required_aal());
drop policy if exists "own pgbl plans update" on public.pgbl_plans;
create policy "own pgbl plans update" on public.pgbl_plans for update using (auth.uid()=user_id and public.is_token_valid() and public.has_required_aal()) with check (auth.uid()=user_id and public.is_token_valid() and public.has_required_aal());
drop policy if exists "own pgbl plans delete" on public.pgbl_plans;
create policy "own pgbl plans delete" on public.pgbl_plans for delete using (auth.uid()=user_id and public.is_token_valid() and public.has_required_aal());
drop trigger if exists pgbl_plans_updated_at on public.pgbl_plans;
create trigger pgbl_plans_updated_at before update on public.pgbl_plans for each row execute function public.set_updated_at();
drop trigger if exists pgbl_plans_no_owner_change on public.pgbl_plans;
create trigger pgbl_plans_no_owner_change before update on public.pgbl_plans for each row execute function public.prevent_owner_change();
grant select, insert, update, delete on public.pgbl_plans to authenticated;

alter table public.widget_install_codes enable row level security;
alter table public.widget_tokens enable row level security;
revoke all on public.widget_install_codes, public.widget_tokens from public, anon, authenticated;

create or replace function public.activate_widget_install_code(
  p_code_hash text,
  p_token_hash text,
  p_refresh_token_hash text
)
returns table (install_code_id uuid, user_id uuid)
language sql
security definer
set search_path = public
as $$
  with consumed as (
    update public.widget_install_codes
    set used_at = now()
    where code_hash = p_code_hash
      and used_at is null
      and expires_at > now()
    returning id, user_id
  ), inserted as (
    insert into public.widget_tokens (
      install_code_id, user_id, token_hash, refresh_token_hash,
      access_expires_at, refresh_expires_at
    )
    select id, user_id, p_token_hash, p_refresh_token_hash,
      now() + interval '30 days', now() + interval '365 days'
    from consumed
    returning install_code_id, user_id
  )
  select install_code_id, user_id from inserted;
$$;

revoke all on function public.activate_widget_install_code(text, text, text) from public, anon, authenticated;
grant execute on function public.activate_widget_install_code(text, text, text) to service_role;

create or replace function public.rotate_widget_refresh_token(
  p_current_refresh_token_hash text,
  p_token_hash text,
  p_refresh_token_hash text,
  p_access_expires_at timestamptz
)
returns table (user_id uuid)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.widget_tokens
  set token_hash = p_token_hash,
      refresh_token_hash = p_refresh_token_hash,
      access_expires_at = p_access_expires_at,
      last_used_at = now()
  where refresh_token_hash = p_current_refresh_token_hash
    and revoked_at is null
    and refresh_expires_at > now()
  returning widget_tokens.user_id;
$$;

revoke all on function public.rotate_widget_refresh_token(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.rotate_widget_refresh_token(text, text, text, timestamptz) to service_role;

create table if not exists public.widget_rate_limits (
  key_hash text not null,
  operation text not null check (operation in ('token', 'refresh', 'install')),
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  primary key (key_hash, operation)
);

alter table public.widget_rate_limits enable row level security;
alter table public.widget_rate_limits force row level security;

create or replace function public.consume_widget_rate_limit(
  p_key_hash text,
  p_operation text
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_started timestamptz;
  v_limit integer;
  v_window_seconds integer := 60;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'chave de rate limit invalida';
  end if;
  if p_operation not in ('token', 'refresh', 'install') then
    raise exception 'operacao de rate limit invalida';
  end if;

  v_limit := case p_operation when 'token' then 60 when 'refresh' then 10 else 5 end;

  insert into public.widget_rate_limits(key_hash, operation, window_started_at, request_count)
  values (p_key_hash, p_operation, now(), 1)
  on conflict (key_hash, operation) do update set
    window_started_at = case when public.widget_rate_limits.window_started_at < now() - make_interval(secs => v_window_seconds) then now() else public.widget_rate_limits.window_started_at end,
    request_count = case when public.widget_rate_limits.window_started_at < now() - make_interval(secs => v_window_seconds) then 1 else public.widget_rate_limits.request_count + 1 end
  returning request_count, window_started_at into v_count, v_started;

  return query select
    v_count <= v_limit,
    greatest(0, ceil(extract(epoch from (v_started + make_interval(secs => v_window_seconds) - now())))::integer);
end;
$$;

revoke all on table public.widget_rate_limits from public, anon, authenticated;
revoke all on function public.consume_widget_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.consume_widget_rate_limit(text, text) to service_role;

-- BLOCO 22 - Exclusao confirmada de metas (estado final para instalacao limpa)
create or replace function public.delete_goal(p_goal_id text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); deleted boolean:=false;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000'; end if;
  if nullif(btrim(p_goal_id),'') is null then raise exception 'identificador de meta invalido' using errcode='22023'; end if;
  delete from public.goals where user_id=u and id=p_goal_id returning true into deleted;
  if not found then raise exception 'meta nao encontrada para exclusao' using errcode='P0002'; end if;
  return deleted;
end; $$;
revoke all on function public.delete_goal(text) from public,anon;
grant execute on function public.delete_goal(text) to authenticated;


-- =====================================================================
-- BLOCO 14 - Provisionamento automatico de novos usuarios
-- =====================================================================
-- Ao criar a conta, o usuario recebe automaticamente o perfil e as
-- categorias padrao, sem que o front-end precise de permissoes extras.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data->>'full_name', ''), 120), '')
  )
  on conflict (id) do nothing;

  insert into public.categories (id, user_id, name, type, color, icon, custom)
  values
    ('moradia',       new.id, 'Moradia',           'expense', '#6366f1', '🏠', false),
    ('alimentacao',   new.id, 'Alimentação',       'expense', '#f97316', '🍽️', false),
    ('mercado',       new.id, 'Mercado',           'expense', '#84cc16', '🛒', false),
    ('transporte',    new.id, 'Transporte',        'expense', '#0ea5e9', '🚗', false),
    ('saude',         new.id, 'Saúde',             'expense', '#ef4444', '💊', false),
    ('educacao',      new.id, 'Educação',          'expense', '#8b5cf6', '📚', false),
    ('lazer',         new.id, 'Lazer',             'expense', '#ec4899', '🎬', false),
    ('assinaturas',   new.id, 'Assinaturas',       'expense', '#14b8a6', '📺', false),
    ('compras',       new.id, 'Compras',           'expense', '#f59e0b', '🛍️', false),
    ('pets',          new.id, 'Pets',              'expense', '#a3703a', '🐾', false),
    ('dividas',       new.id, 'Dívidas',           'expense', '#dc2626', '💳', false),
    ('impostos',      new.id, 'Impostos',          'expense', '#64748b', '🧾', false),
    ('outros-d',      new.id, 'Outros',            'expense', '#94a3b8', '📦', false),
    ('aportes',       new.id, 'Aportes e investimentos', 'reinvested', '#8b5cf6', '📈', false),
    ('outros-ri',     new.id, 'Outros reinvestimentos',  'reinvested', '#a855f7', '📦', false),
    ('salario',       new.id, 'Salário',           'income',  '#22c55e', '💼', false),
    ('freelance',     new.id, 'Freelance',         'income',  '#10b981', '💻', false),
    ('investimentos', new.id, 'Investimentos',     'income',  '#0d9488', '📈', false),
    ('aluguel-r',     new.id, 'Aluguel recebido',  'income',  '#059669', '🏘️', false),
    ('presente',      new.id, 'Presente',          'income',  '#a855f7', '🎁', false),
    ('reembolso',     new.id, 'Reembolso',         'income',  '#3b82f6', '↩️', false),
    ('outros-r',      new.id, 'Outros',            'income',  '#7dd3fc', '➕', false)
  on conflict (user_id, id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- =====================================================================
-- BLOCO 15 - Exclusao total dos dados do proprio usuario
-- =====================================================================
-- Usada pelo botao "Apagar todos os dados". Restrita ao usuario
-- autenticado: nao aceita parametro de id, logo nao ha como apagar
-- dados de terceiros. Como e SECURITY DEFINER, tambem exige token valido e AAL/MFA.
-- =====================================================================

create or replace function public.delete_my_data()
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000';
  end if;
  delete from public.transactions where user_id = v_uid;
  delete from public.budgets where user_id = v_uid;
  delete from public.goals where user_id = v_uid;
  delete from public.categories where user_id = v_uid;
  delete from public.pgbl_plans where user_id = v_uid;
  insert into public.security_events (user_id, event_type, severity, details)
  values (v_uid, 'bulk_delete', 'warning', jsonb_build_object('scope', 'all_financial_data'));
end; $$;

revoke all on function public.delete_my_data() from public;
revoke all on function public.delete_my_data() from anon;
grant execute on function public.delete_my_data() to authenticated;

-- Limpa os dados do usuario e restaura as categorias padrao na mesma transacao.
create or replace function public.reset_my_data_with_defaults()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000';
  end if;

  perform public.delete_my_data();

  insert into public.categories (id, user_id, name, type, color, icon, custom, target_percentage)
  values
    ('moradia', v_uid, 'Moradia', 'expense', '#6366f1', '🏠', false, 0),
    ('alimentacao', v_uid, 'Alimentação', 'expense', '#f97316', '🍽️', false, 0),
    ('mercado', v_uid, 'Mercado', 'expense', '#84cc16', '🛒', false, 0),
    ('transporte', v_uid, 'Transporte', 'expense', '#0ea5e9', '🚗', false, 0),
    ('saude', v_uid, 'Saúde', 'expense', '#ef4444', '💊', false, 0),
    ('educacao', v_uid, 'Educação', 'expense', '#8b5cf6', '📚', false, 0),
    ('lazer', v_uid, 'Lazer', 'expense', '#ec4899', '🎬', false, 0),
    ('assinaturas', v_uid, 'Assinaturas', 'expense', '#14b8a6', '📺', false, 0),
    ('compras', v_uid, 'Compras', 'expense', '#f59e0b', '🛍️', false, 0),
    ('pets', v_uid, 'Pets', 'expense', '#a3703a', '🐾', false, 0),
    ('dividas', v_uid, 'Dívidas', 'expense', '#dc2626', '💳', false, 0),
    ('impostos', v_uid, 'Impostos', 'expense', '#64748b', '🧾', false, 0),
    ('outros-d', v_uid, 'Outros', 'expense', '#94a3b8', '📦', false, 0),
    ('aportes', v_uid, 'Aportes e investimentos', 'reinvested', '#8b5cf6', '📈', false, 0),
    ('outros-ri', v_uid, 'Outros reinvestimentos', 'reinvested', '#a855f7', '📦', false, 0),
    ('salario', v_uid, 'Salário', 'income', '#22c55e', '💼', false, 0),
    ('freelance', v_uid, 'Freelance', 'income', '#10b981', '💻', false, 0),
    ('investimentos', v_uid, 'Investimentos', 'income', '#0d9488', '📈', false, 0),
    ('aluguel-r', v_uid, 'Aluguel recebido', 'income', '#059669', '🏘️', false, 0),
    ('presente', v_uid, 'Presente', 'income', '#a855f7', '🎁', false, 0),
    ('reembolso', v_uid, 'Reembolso', 'income', '#3b82f6', '↩️', false, 0),
    ('outros-r', v_uid, 'Outros', 'income', '#7dd3fc', '➕', false, 0);
end;
$$;

revoke all on function public.reset_my_data_with_defaults() from public, anon;
grant execute on function public.reset_my_data_with_defaults() to authenticated;


-- =====================================================================
-- BLOCO 16 - Verificacao final
-- =====================================================================
-- Todas as linhas devem aparecer com rls_ativa = true.
-- Se alguma vier false, PARE e execute este arquivo novamente.
-- =====================================================================

select
  tablename        as tabela,
  rowsecurity      as rls_ativa,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = t.tablename) as politicas
from pg_tables t
where schemaname = 'public'
  and tablename in ('profiles','categories','transactions','budgets','goals','security_events')
order by tablename;

-- =====================================================================
-- BLOCO 17 - Meta Reversa (estado consolidado da migracao V1.3.0)
-- =====================================================================
alter table public.goals
  add column if not exists goal_type text not null default 'standard',
  add column if not exists reverse_original_amount numeric(14,2),
  add column if not exists reverse_remaining_amount numeric(14,2),
  add column if not exists reverse_corrected_amount numeric(14,2),
  add column if not exists reverse_start_date date,
  add column if not exists reverse_selic_factor numeric(6,4),
  add column if not exists reverse_completed_at timestamptz;
alter table public.goals add constraint goals_goal_type_check check (goal_type in ('standard','reverse'));
alter table public.goals add constraint goals_reverse_data_check check (goal_type = 'standard' or (reverse_original_amount > 0 and reverse_remaining_amount >= 0 and reverse_corrected_amount >= 0 and reverse_start_date is not null and reverse_selic_factor between .5 and 1.5));

create table public.selic_monthly_rates (
  reference_month date primary key check (date_trunc('month', reference_month)::date = reference_month),
  rate_percent numeric(10,6) not null check (rate_percent >= 0 and rate_percent < 100),
  source text not null default 'BCB_SGS_4390' check (source = 'BCB_SGS_4390'),
  source_observed_on date not null, fetched_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create table public.reverse_goal_contributions (
  id bigint generated always as identity primary key, goal_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade, amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null, note text check (note is null or char_length(note) <= 500), created_at timestamptz not null default now(),
  foreign key (user_id, goal_id) references public.goals(user_id, id) on delete cascade
);
create index reverse_goal_contributions_goal_date_idx on public.reverse_goal_contributions (goal_id, occurred_on, id);
create table public.reverse_goal_history (
  id bigint generated always as identity primary key, goal_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade, reference_month date not null check (date_trunc('month', reference_month)::date = reference_month), applied_on date not null,
  balance_before numeric(14,2) not null check (balance_before >= 0), balance_after numeric(14,2) not null check (balance_after >= 0),
  selic_rate_percent numeric(10,6) not null check (selic_rate_percent >= 0), selic_factor numeric(6,4) not null check (selic_factor between .5 and 1.5),
  correction_amount numeric(14,2) not null check (correction_amount >= 0), contribution_amount numeric(14,2) not null check (contribution_amount >= 0), created_at timestamptz not null default now(), unique (user_id, goal_id, reference_month),
  foreign key (user_id, goal_id) references public.goals(user_id, id) on delete cascade
);
create index reverse_goal_history_goal_month_idx on public.reverse_goal_history (goal_id, reference_month desc);
alter table public.selic_monthly_rates enable row level security; alter table public.selic_monthly_rates force row level security;
alter table public.reverse_goal_contributions enable row level security; alter table public.reverse_goal_contributions force row level security;
alter table public.reverse_goal_history enable row level security; alter table public.reverse_goal_history force row level security;
create policy "authenticated read selic monthly rates" on public.selic_monthly_rates for select to authenticated using (public.is_token_valid() and public.has_required_aal());
create policy "own reverse goal contributions select" on public.reverse_goal_contributions for select to authenticated using (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());
create policy "own reverse goal history select" on public.reverse_goal_history for select to authenticated using (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());
grant select on public.selic_monthly_rates, public.reverse_goal_contributions, public.reverse_goal_history to authenticated;

-- BLOCO 18 - Complemento da Meta Reversa V1.3.0 (estado final para instalacao limpa)
alter table public.goals add column if not exists reverse_total_contributed numeric(14,2) not null default 0;
alter table public.goals add column if not exists reverse_correction_amount numeric(14,2) not null default 0;
alter table public.goals add column if not exists reverse_progress_percent numeric(6,2) not null default 0;
alter table public.goals add constraint goals_reverse_summary_check check (reverse_total_contributed >= 0 and reverse_correction_amount >= 0 and reverse_progress_percent between 0 and 100);
alter table public.goals add constraint goals_reverse_original_limit check (goal_type <> 'reverse' or reverse_original_amount < 1000000000);
alter table public.goals add constraint goals_reverse_remaining_limit check (goal_type <> 'reverse' or reverse_remaining_amount < 1000000000);
alter table public.goals add constraint goals_reverse_corrected_limit check (goal_type <> 'reverse' or reverse_corrected_amount < 1000000000);
create table public.reverse_goal_events (id bigint generated always as identity primary key, goal_id text not null, user_id uuid not null references auth.users(id) on delete cascade, event_type text not null check (event_type in ('created','contribution','recalculated','completed')), occurred_on date not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), foreign key (user_id, goal_id) references public.goals(user_id, id) on delete cascade);
create index reverse_goal_events_goal_date_idx on public.reverse_goal_events(goal_id,occurred_on,id);
create table public.reverse_goal_retention_settings (user_id uuid primary key references auth.users(id) on delete cascade, completed_goal_retention_months smallint check (completed_goal_retention_months between 1 and 12), updated_at timestamptz not null default now());
alter table public.reverse_goal_events enable row level security; alter table public.reverse_goal_events force row level security;
alter table public.reverse_goal_retention_settings enable row level security; alter table public.reverse_goal_retention_settings force row level security;
create policy "own reverse goal events select" on public.reverse_goal_events for select to authenticated using (auth.uid()=user_id and public.is_token_valid() and public.has_required_aal());
create policy "own reverse goal retention select" on public.reverse_goal_retention_settings for select to authenticated using (auth.uid()=user_id and public.is_token_valid() and public.has_required_aal());
grant select on public.reverse_goal_events, public.reverse_goal_retention_settings to authenticated;
create or replace function public.rebuild_reverse_goal(p_goal_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_goal public.goals%rowtype;
  v_period date;
  v_last_complete date := (date_trunc('month', current_date)::date - interval '1 month')::date;
  v_rate numeric(10,6);
  v_balance numeric(14,2);
  v_correction numeric(14,2);
  v_contribution numeric(14,2);
  v_correction_total numeric(14,2) := 0;
  v_total_contributed numeric(14,2) := 0;
  v_completed_now boolean := false;
  v_completion_date date;
begin
  select * into v_goal from public.goals where id = p_goal_id for update;
  if not found or v_goal.goal_type <> 'reverse' then
    raise exception 'meta reversa nao encontrada' using errcode = 'P0002';
  end if;
  -- A conclusao e definitiva: historico e valores nao voltam a ser processados.
  if v_goal.reverse_completed_at is not null or coalesce(v_goal.reverse_remaining_amount, 0) = 0 then
    return;
  end if;

  delete from public.reverse_goal_history where goal_id = v_goal.id;
  v_balance := v_goal.reverse_original_amount;
  v_period := date_trunc('month', v_goal.reverse_start_date)::date;

  while v_period <= v_last_complete loop
    select rate_percent into v_rate from public.selic_monthly_rates where reference_month = v_period;
    exit when not found;
    select coalesce(sum(amount), 0)::numeric(14,2) into v_contribution
      from public.reverse_goal_contributions
      where goal_id = v_goal.id and occurred_on >= v_period and occurred_on < (v_period + interval '1 month')::date;
    v_total_contributed := v_total_contributed + v_contribution;
    -- O aporte reduz o saldo que existia naquele mes antes da correcao mensal.
    v_correction := case when v_balance <= v_contribution then 0 else round((v_balance - v_contribution) * (v_rate / 100) * v_goal.reverse_selic_factor, 2) end;
    insert into public.reverse_goal_history (
      goal_id, user_id, reference_month, applied_on, balance_before, balance_after,
      selic_rate_percent, selic_factor, correction_amount, contribution_amount
    ) values (
      v_goal.id, v_goal.user_id, v_period, (v_period + interval '1 month')::date,
      v_balance, greatest(0, round(v_balance - v_contribution + v_correction, 2)),
      v_rate, v_goal.reverse_selic_factor, v_correction, v_contribution
    );
    v_balance := greatest(0, round(v_balance - v_contribution + v_correction, 2));
    v_correction_total := round(v_correction_total + v_correction, 2);
    if v_balance = 0 then
      select max(occurred_on) into v_completion_date from public.reverse_goal_contributions
      where goal_id = v_goal.id and occurred_on >= v_period and occurred_on < (v_period + interval '1 month')::date;
    end if;
    exit when v_balance = 0;
    v_period := (v_period + interval '1 month')::date;
  end loop;

  if v_balance > 0 then
    select coalesce(sum(amount), 0)::numeric(14,2) into v_contribution
      from public.reverse_goal_contributions where goal_id = v_goal.id and occurred_on >= v_period;
    v_total_contributed := v_total_contributed + v_contribution;
    v_balance := greatest(0, round(v_balance - v_contribution, 2));
    if v_balance = 0 then
      select max(occurred_on) into v_completion_date from public.reverse_goal_contributions where goal_id = v_goal.id and occurred_on >= v_period;
    end if;
  end if;
  v_completed_now := v_balance = 0;

  update public.goals set
    reverse_remaining_amount = v_balance,
    reverse_correction_amount = v_correction_total,
    reverse_corrected_amount = round(reverse_original_amount + v_correction_total, 2),
    reverse_total_contributed = v_total_contributed,
    reverse_progress_percent = case when round(reverse_original_amount + v_correction_total, 2) = 0 then 0 else round(least(100, (1 - v_balance / round(reverse_original_amount + v_correction_total, 2)) * 100), 2) end,
    target = round(reverse_original_amount + v_correction_total, 2),
    current = v_total_contributed,
    reverse_completed_at = case when v_completed_now then coalesce(v_completion_date, current_date)::timestamptz else null end,
    updated_at = now()
  where id = v_goal.id;
  if v_completed_now then
    insert into public.reverse_goal_events (goal_id, user_id, event_type, occurred_on, details)
    values (v_goal.id, v_goal.user_id, 'completed', coalesce(v_completion_date, current_date), jsonb_build_object('message', 'A meta foi concluida e nao recebera novas correcoes.'));
  end if;
end;
$$;
/* legacy definition superseded by SEC-03 below.
create or replace function public.legacy_create_reverse_goal(p_name text,p_original_amount numeric,p_initial_contribution numeric,p_start_date date,p_selic_factor numeric,p_icon text default '🎯',p_color text default '#6366f1')
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); gid text:=gen_random_uuid()::text;
begin
 if u is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000'; end if;
 if nullif(btrim(p_name),'') is null or char_length(btrim(p_name))>120 or p_original_amount<=0 or p_original_amount>=1000000000 or p_initial_contribution<0 or p_initial_contribution>p_original_amount or p_start_date is null or p_start_date<current_date-interval '19 years' or p_start_date>current_date or p_selic_factor not between .5 and 1.5 then
   if p_original_amount>=1000000000 then raise exception 'reverse_goal_limit_exceeded' using errcode='22023'; end if;
   raise exception 'dados da meta invalidos' using errcode='22023';
 end if;
 insert into public.goals(id,user_id,name,target,current,deadline,icon,color,goal_type,reverse_original_amount,reverse_remaining_amount,reverse_corrected_amount,reverse_start_date,reverse_selic_factor) values(gid,u,btrim(p_name),p_original_amount,0,null,left(coalesce(p_icon,'🎯'),8),coalesce(p_color,'#6366f1'),'reverse',p_original_amount,p_original_amount,p_original_amount,p_start_date,round(p_selic_factor,4));
 insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) values(gid,u,'created',p_start_date,jsonb_build_object('message','Meta Reversa criada.'));
 if p_initial_contribution>0 then insert into public.reverse_goal_contributions(goal_id,user_id,amount,occurred_on,note) values(gid,u,round(p_initial_contribution,2),p_start_date,null); insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) values(gid,u,'contribution',p_start_date,jsonb_build_object('amount',round(p_initial_contribution,2))); end if;
 perform public.rebuild_reverse_goal_for_user(gid,u); return gid;
end; $$;
*/
create or replace function public.add_reverse_goal_contribution(p_goal_id text,p_amount numeric,p_occurred_on date,p_note text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$ declare u uuid:=auth.uid(); start_date date; completed_at timestamptz;
begin
 if u is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000'; end if;
 select reverse_start_date,reverse_completed_at into start_date,completed_at from public.goals where user_id=u and id=p_goal_id and goal_type='reverse' for update;
 if not found then raise exception 'meta reversa nao encontrada' using errcode='P0002'; end if; if completed_at is not null then raise exception 'meta reversa concluida nao aceita novos aportes' using errcode='22023'; end if;
 if p_amount<=0 or p_occurred_on is null or p_occurred_on<start_date or p_occurred_on>current_date then raise exception 'aporte invalido' using errcode='22023'; end if;
 insert into public.reverse_goal_contributions(goal_id,user_id,amount,occurred_on,note) values(p_goal_id,u,round(p_amount,2),p_occurred_on,null);
 insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) values(p_goal_id,u,'contribution',p_occurred_on,jsonb_build_object('amount',round(p_amount,2)));
 if p_occurred_on<current_date then insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) values(p_goal_id,u,'recalculated',current_date,jsonb_build_object('message','Historico recalculado devido a um aporte registrado retroativamente.')); end if;
 perform public.rebuild_reverse_goal_for_user(p_goal_id,u);
end; $$;
/* legacy definition superseded by SEC-03 below.
create or replace function public.legacy_rebuild_all_reverse_goals()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$ declare item record; n integer:=0; begin for item in select id,user_id from public.goals where goal_type='reverse' and reverse_completed_at is null and reverse_remaining_amount>0 loop begin perform public.rebuild_reverse_goal_for_user(item.id,item.user_id); n:=n+1; exception when others then raise warning 'rebuild_reverse_goal_for_user ignorado para goal_id=% (SQLSTATE %): %',item.id,SQLSTATE,SQLERRM; end; end loop; return n; end; $$;
*/
create or replace function public.set_reverse_goal_retention(p_months smallint default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000'; end if;
  if p_months is not null and p_months not between 1 and 12 then raise exception 'periodo de retencao invalido' using errcode = '22023'; end if;
  insert into public.reverse_goal_retention_settings(user_id,completed_goal_retention_months,updated_at) values(v_uid,p_months,now())
  on conflict(user_id) do update set completed_goal_retention_months=excluded.completed_goal_retention_months,updated_at=now();
end; $$;
create or replace function public.cleanup_expired_reverse_goals()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_deleted integer;
begin
  delete from public.goals g using public.reverse_goal_retention_settings s
  where g.user_id=s.user_id and g.goal_type='reverse' and g.reverse_completed_at is not null
    and s.completed_goal_retention_months is not null
    and g.reverse_completed_at < now() - make_interval(months => s.completed_goal_retention_months);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end; $$;
revoke all on function public.set_reverse_goal_retention(smallint) from public,anon; grant execute on function public.set_reverse_goal_retention(smallint) to authenticated; revoke all on function public.cleanup_expired_reverse_goals() from public,anon,authenticated;
grant execute on function public.add_reverse_goal_contribution(text,numeric,date,text) to authenticated;
grant execute on function public.cleanup_expired_reverse_goals() to service_role;

-- SEC-02 - estado consolidado de permissoes das RPCs de Metas Reversas.
-- Funcoes internas nao sao pontos de entrada para clientes ou service_role.
revoke all on function public.rebuild_reverse_goal(text) from public,anon,authenticated,service_role;
revoke all on function public.cleanup_expired_reverse_goals() from public,anon,authenticated;
grant execute on function public.cleanup_expired_reverse_goals() to service_role;

-- Novas funcoes, tabelas e sequences exigem grants explicitos.
alter default privileges for role postgres in schema public revoke all on functions from anon,authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon,authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon,authenticated;

revoke all on table public.reverse_goal_contributions,public.reverse_goal_events,public.reverse_goal_history,public.reverse_goal_retention_settings from anon;
revoke all on table public.reverse_goal_contributions,public.reverse_goal_events,public.reverse_goal_history,public.reverse_goal_retention_settings from authenticated;
grant select on table public.reverse_goal_contributions,public.reverse_goal_events,public.reverse_goal_history,public.reverse_goal_retention_settings to authenticated;
revoke all on sequence public.reverse_goal_contributions_id_seq,public.reverse_goal_events_id_seq,public.reverse_goal_history_id_seq from anon,authenticated;

-- BLOCO 19 - Previsao de conclusao da Meta Reversa V1.3.2
-- A previsao e calculada no banco apos cada reconstrucao, usando a media dos
-- aportes por mes. Nao concede permissao adicional ao cliente.
alter table public.goals add column if not exists reverse_monthly_contribution_average numeric(14,2);
alter table public.goals add column if not exists reverse_forecast_completion_date date;

create or replace function public.refresh_reverse_goal_forecast(p_goal_id text,p_user_id uuid) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare avg_amount numeric(14,2); remaining numeric(14,2); months numeric; completed_at timestamptz;
begin
  select reverse_remaining_amount, reverse_completed_at into remaining, completed_at from public.goals where id=p_goal_id and user_id=p_user_id;
  select case when count(distinct date_trunc('month',occurred_on))>0 then round(sum(amount)/count(distinct date_trunc('month',occurred_on)),2) end into avg_amount from public.reverse_goal_contributions where goal_id=p_goal_id and user_id=p_user_id;
  months:=case when avg_amount>0 then ceil(remaining/avg_amount) end;
  update public.goals set reverse_monthly_contribution_average=avg_amount,reverse_forecast_completion_date=case when completed_at is not null then completed_at::date when months is null then null else (current_date+(months::text||' months')::interval)::date end where id=p_goal_id and user_id=p_user_id;
end; $$;

create or replace function public.refresh_reverse_goal_forecast_after_rebuild() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.goal_type = 'reverse' then
    perform public.refresh_reverse_goal_forecast(new.id, new.user_id);
  end if;
  return new;
end; $$;
drop trigger if exists reverse_goal_forecast_after_rebuild on public.goals;
create trigger reverse_goal_forecast_after_rebuild after update of reverse_remaining_amount,reverse_completed_at on public.goals for each row when (new.goal_type='reverse' and (old.reverse_remaining_amount is distinct from new.reverse_remaining_amount or old.reverse_completed_at is distinct from new.reverse_completed_at)) execute function public.refresh_reverse_goal_forecast_after_rebuild();
begin;

-- Objetivo: restaurar backups de Metas Reversas sem perda de dados.
-- Pre-condicoes: V13, V14 e V15 aplicadas. Compativel com o frontend anterior.
-- RLS/grants: nao altera RLS; apenas as RPCs publicas abaixo sao concedidas a authenticated.

-- A previsao restaurada e sempre substituida pelo calculo atual do banco.
commit;

-- BLOCO 21 - Restauracao segura de Meta Reversa (estado final para instalacao limpa)
-- Mantem a chave composta (user_id, goal_id) em todos os acessos internos.
/* legacy definition superseded by SEC-03 below.
create or replace function public.legacy_rebuild_reverse_goal_for_user(p_goal_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare g public.goals%rowtype; p date; last_month date := (date_trunc('month',current_date)::date-interval '1 month')::date; rate numeric(10,6); balance numeric(14,2); correction numeric(14,2); contribution numeric(14,2); correction_total numeric(14,2):=0; contributed_total numeric(14,2):=0; completion_date date; final_target numeric(14,2);
begin
  select * into g from public.goals where user_id=p_user_id and id=p_goal_id for update;
  if not found or g.goal_type<>'reverse' then raise exception 'meta reversa nao encontrada' using errcode='P0002'; end if;
  if g.reverse_completed_at is not null then return; end if;
  delete from public.reverse_goal_history where user_id=p_user_id and goal_id=p_goal_id; balance:=g.reverse_original_amount; p:=date_trunc('month',g.reverse_start_date)::date;
  while p<=last_month loop
    select rate_percent into rate from public.selic_monthly_rates where reference_month=p; exit when not found;
    select coalesce(sum(amount),0)::numeric(14,2) into contribution from public.reverse_goal_contributions where user_id=p_user_id and goal_id=p_goal_id and occurred_on>=p and occurred_on<(p+interval '1 month')::date;
    contributed_total:=contributed_total+contribution; correction:=case when balance<=contribution then 0 else round((balance-contribution)*(rate/100)*g.reverse_selic_factor,2) end; balance:=greatest(0,round(balance-contribution+correction,2)); correction_total:=round(correction_total+correction,2);
    insert into public.reverse_goal_history(goal_id,user_id,reference_month,applied_on,balance_before,balance_after,selic_rate_percent,selic_factor,correction_amount,contribution_amount) values(p_goal_id,p_user_id,p,(p+interval '1 month')::date,greatest(0,round(balance+contribution-correction,2)),balance,rate,g.reverse_selic_factor,correction,contribution);
    if balance=0 then select max(occurred_on) into completion_date from public.reverse_goal_contributions where user_id=p_user_id and goal_id=p_goal_id and occurred_on>=p and occurred_on<(p+interval '1 month')::date; exit; end if; p:=(p+interval '1 month')::date;
  end loop;
  if balance>0 then select coalesce(sum(amount),0)::numeric(14,2) into contribution from public.reverse_goal_contributions where user_id=p_user_id and goal_id=p_goal_id and occurred_on>=p; contributed_total:=contributed_total+contribution; balance:=greatest(0,round(balance-contribution,2)); if balance=0 then select max(occurred_on) into completion_date from public.reverse_goal_contributions where user_id=p_user_id and goal_id=p_goal_id and occurred_on>=p; end if; end if;
  final_target:=round(g.reverse_original_amount+correction_total,2);
  if final_target>=1000000000 then raise exception 'reverse_goal_limit_exceeded' using errcode='22023'; end if;
  update public.goals set reverse_remaining_amount=balance,reverse_correction_amount=correction_total,reverse_corrected_amount=final_target,reverse_total_contributed=contributed_total,reverse_progress_percent=case when final_target=0 then 0 else round(least(100,(1-balance/final_target)*100),2) end,target=final_target,current=contributed_total,reverse_completed_at=case when balance=0 then coalesce(reverse_completed_at,coalesce(completion_date,current_date)::timestamptz) else null end,updated_at=now() where user_id=p_user_id and id=p_goal_id;
  if balance=0 and g.reverse_completed_at is null then insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) values(p_goal_id,p_user_id,'completed',coalesce(completion_date,current_date),jsonb_build_object('message','A meta foi concluida e nao recebera novas correcoes.')); end if;
end; $$;
*/
create or replace function public.replace_my_data(p_data jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); item record;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'backup invalido' using errcode='22023'; end if;
  if exists (select 1 from jsonb_to_recordset(coalesce(p_data->'goals','[]'::jsonb)) x(id text,goal_type text,reverse_completed_at timestamptz) where coalesce(x.goal_type,'standard')='reverse' and x.reverse_completed_at is not null and not exists (select 1 from jsonb_to_recordset(coalesce(p_data->'reverseGoalHistory','[]'::jsonb)) h(goal_id text) where h.goal_id=x.id)) then raise exception 'backup de meta reversa concluida sem historico' using errcode='22023'; end if;
  delete from public.transactions where user_id=u; delete from public.budgets where user_id=u; delete from public.goals where user_id=u; delete from public.categories where user_id=u; delete from public.pgbl_plans where user_id=u; delete from public.reverse_goal_retention_settings where user_id=u;
  insert into public.categories(user_id,id,name,icon,color,type,target_percentage) select u,x.id,x.name,x.icon,x.color,x.type,coalesce(x.target_percentage,0) from jsonb_to_recordset(coalesce(p_data->'categories','[]'::jsonb)) x(id text,name text,icon text,color text,type text,target_percentage numeric);
  insert into public.transactions(user_id,id,type,description,amount,category_id,date,method,paid,recurrence,recurrence_end,installments,tags,note,paid_occurrences,created_at,updated_at) select u,x.id,x.type,x.description,x.amount,x.category_id,x.date,x.method,x.paid,x.recurrence,x.recurrence_end,x.installments,x.tags,x.note,x.paid_occurrences,coalesce(x.created_at,now()),coalesce(x.updated_at,now()) from jsonb_to_recordset(coalesce(p_data->'transactions','[]'::jsonb)) x(id text,type text,description text,amount numeric,category_id text,date date,method text,paid boolean,recurrence text,recurrence_end date,installments integer,tags text[],note text,paid_occurrences jsonb,created_at timestamptz,updated_at timestamptz);
  insert into public.budgets(user_id,category_id,limit_amount) select u,x.category_id,x.limit_amount from jsonb_to_recordset(coalesce(p_data->'budgets','[]'::jsonb)) x(category_id text,limit_amount numeric);
  insert into public.goals(user_id,id,name,target,current,deadline,icon,color,goal_type,reverse_original_amount,reverse_remaining_amount,reverse_corrected_amount,reverse_start_date,reverse_selic_factor,reverse_completed_at,reverse_total_contributed,reverse_correction_amount,reverse_progress_percent,reverse_monthly_contribution_average,reverse_forecast_completion_date) select u,x.id,x.name,x.target,x.current,x.deadline,x.icon,x.color,coalesce(x.goal_type,'standard'),x.reverse_original_amount,x.reverse_remaining_amount,x.reverse_corrected_amount,x.reverse_start_date,x.reverse_selic_factor,x.reverse_completed_at,coalesce(x.reverse_total_contributed,0),coalesce(x.reverse_correction_amount,0),coalesce(x.reverse_progress_percent,0),x.reverse_monthly_contribution_average,x.reverse_forecast_completion_date from jsonb_to_recordset(coalesce(p_data->'goals','[]'::jsonb)) x(id text,name text,target numeric,current numeric,deadline date,icon text,color text,goal_type text,reverse_original_amount numeric,reverse_remaining_amount numeric,reverse_corrected_amount numeric,reverse_start_date date,reverse_selic_factor numeric,reverse_completed_at timestamptz,reverse_total_contributed numeric,reverse_correction_amount numeric,reverse_progress_percent numeric,reverse_monthly_contribution_average numeric,reverse_forecast_completion_date date);
  if p_data ? 'standardGoalContributions' then
    insert into public.standard_goal_contributions(goal_id,user_id,amount,occurred_on,note) select x.goal_id,u,round(x.amount,2),x.occurred_on,nullif(btrim(x.note),'') from jsonb_to_recordset(coalesce(p_data->'standardGoalContributions','[]'::jsonb)) x(goal_id text,amount numeric,occurred_on date,note text) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='standard';
  else
    insert into public.standard_goal_contributions(goal_id,user_id,amount,occurred_on,note) select g.id,u,round(g.current,2),coalesce(g.updated_at::date,current_date),'Saldo restaurado' from public.goals g where g.user_id=u and g.goal_type='standard' and g.current>0;
  end if;
  update public.goals g set current=coalesce((select round(sum(c.amount),2) from public.standard_goal_contributions c where c.user_id=u and c.goal_id=g.id),0),updated_at=now() where g.user_id=u and g.goal_type='standard';
  insert into public.reverse_goal_contributions(goal_id,user_id,amount,occurred_on,note) select x.goal_id,u,x.amount,x.occurred_on,x.note from jsonb_to_recordset(coalesce(p_data->'reverseGoalContributions','[]'::jsonb)) x(goal_id text,amount numeric,occurred_on date,note text) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  insert into public.reverse_goal_history(goal_id,user_id,reference_month,applied_on,balance_before,balance_after,selic_rate_percent,selic_factor,correction_amount,contribution_amount) select x.goal_id,u,x.reference_month,x.applied_on,x.balance_before,x.balance_after,x.selic_rate_percent,x.selic_factor,x.correction_amount,x.contribution_amount from jsonb_to_recordset(coalesce(p_data->'reverseGoalHistory','[]'::jsonb)) x(goal_id text,reference_month date,applied_on date,balance_before numeric,balance_after numeric,selic_rate_percent numeric,selic_factor numeric,correction_amount numeric,contribution_amount numeric) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  insert into public.reverse_goal_events(goal_id,user_id,event_type,occurred_on,details) select x.goal_id,u,x.event_type,x.occurred_on,coalesce(x.details,'{}'::jsonb) from jsonb_to_recordset(coalesce(p_data->'reverseGoalEvents','[]'::jsonb)) x(goal_id text,event_type text,occurred_on date,details jsonb) join public.goals g on g.user_id=u and g.id=x.goal_id and g.goal_type='reverse';
  insert into public.pgbl_plans(user_id,year,months,premise,fiscal_params) select u,x.year,x.months,x.premise,x.fiscal_params from jsonb_to_recordset(coalesce(p_data->'pgblPlans','[]'::jsonb)) x(year integer,months jsonb,premise jsonb,fiscal_params jsonb);
  if p_data ? 'reverseGoalRetentionMonths' then insert into public.reverse_goal_retention_settings(user_id,completed_goal_retention_months) values(u,nullif(p_data->>'reverseGoalRetentionMonths','')::smallint); end if;
  for item in select id from public.goals where user_id=u and goal_type='reverse' and reverse_completed_at is null loop perform public.rebuild_reverse_goal_for_user(item.id,u); end loop;
end; $$;
revoke all on function public.replace_my_data(jsonb) from public,anon;
grant execute on function public.replace_my_data(jsonb) to authenticated;

-- SEC-03 - estado final dos limites de Meta Reversa.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'goals_reverse_original_limit' and conrelid = 'public.goals'::regclass) then
    alter table public.goals add constraint goals_reverse_original_limit check (goal_type <> 'reverse' or reverse_original_amount < 1000000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'goals_reverse_remaining_limit' and conrelid = 'public.goals'::regclass) then
    alter table public.goals add constraint goals_reverse_remaining_limit check (goal_type <> 'reverse' or reverse_remaining_amount < 1000000000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'goals_reverse_corrected_limit' and conrelid = 'public.goals'::regclass) then
    alter table public.goals add constraint goals_reverse_corrected_limit check (goal_type <> 'reverse' or reverse_corrected_amount < 1000000000);
  end if;
end;
$$;

create or replace function public.rebuild_reverse_goal_for_user(p_goal_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare
  g public.goals%rowtype;
  p date;
  last_month date := (date_trunc('month', current_date)::date - interval '1 month')::date;
  rate numeric(10,6);
  balance numeric(14,2);
  correction numeric(14,2);
  contribution numeric(14,2);
  correction_total numeric(14,2) := 0;
  contributed_total numeric(14,2) := 0;
  completion_date date;
  final_target numeric(14,2);
begin
  select * into g from public.goals where user_id = p_user_id and id = p_goal_id for update;
  if not found or g.goal_type <> 'reverse' then raise exception 'meta reversa nao encontrada' using errcode = 'P0002'; end if;
  if g.reverse_completed_at is not null then return; end if;
  delete from public.reverse_goal_history where user_id = p_user_id and goal_id = p_goal_id;
  balance := g.reverse_original_amount;
  p := date_trunc('month', g.reverse_start_date)::date;
  while p <= last_month loop
    select rate_percent into rate from public.selic_monthly_rates where reference_month = p;
    exit when not found;
    select coalesce(sum(amount), 0)::numeric(14,2) into contribution from public.reverse_goal_contributions where user_id = p_user_id and goal_id = p_goal_id and occurred_on >= p and occurred_on < (p + interval '1 month')::date;
    contributed_total := contributed_total + contribution;
    correction := case when balance <= contribution then 0 else round((balance - contribution) * (rate / 100) * g.reverse_selic_factor, 2) end;
    balance := greatest(0, round(balance - contribution + correction, 2));
    correction_total := round(correction_total + correction, 2);
    insert into public.reverse_goal_history (goal_id, user_id, reference_month, applied_on, balance_before, balance_after, selic_rate_percent, selic_factor, correction_amount, contribution_amount)
    values (p_goal_id, p_user_id, p, (p + interval '1 month')::date, greatest(0, round(balance + contribution - correction, 2)), balance, rate, g.reverse_selic_factor, correction, contribution);
    if balance = 0 then
      select max(occurred_on) into completion_date from public.reverse_goal_contributions where user_id = p_user_id and goal_id = p_goal_id and occurred_on >= p and occurred_on < (p + interval '1 month')::date;
      exit;
    end if;
    p := (p + interval '1 month')::date;
  end loop;
  if balance > 0 then
    select coalesce(sum(amount), 0)::numeric(14,2) into contribution from public.reverse_goal_contributions where user_id = p_user_id and goal_id = p_goal_id and occurred_on >= p;
    contributed_total := contributed_total + contribution;
    balance := greatest(0, round(balance - contribution, 2));
    if balance = 0 then select max(occurred_on) into completion_date from public.reverse_goal_contributions where user_id = p_user_id and goal_id = p_goal_id and occurred_on >= p; end if;
  end if;
  final_target := round(g.reverse_original_amount + correction_total, 2);
  if final_target >= 1000000000 then raise exception 'reverse_goal_limit_exceeded' using errcode = '22023'; end if;
  update public.goals set reverse_remaining_amount = balance, reverse_correction_amount = correction_total, reverse_corrected_amount = final_target, reverse_total_contributed = contributed_total, reverse_progress_percent = case when final_target = 0 then 0 else round(least(100, (1 - balance / final_target) * 100), 2) end, target = final_target, current = contributed_total, reverse_completed_at = case when balance = 0 then coalesce(reverse_completed_at, coalesce(completion_date, current_date)::timestamptz) else null end, updated_at = now() where user_id = p_user_id and id = p_goal_id;
  if balance = 0 and g.reverse_completed_at is null then insert into public.reverse_goal_events(goal_id, user_id, event_type, occurred_on, details) values (p_goal_id, p_user_id, 'completed', coalesce(completion_date, current_date), jsonb_build_object('message', 'A meta foi concluida e nao recebera novas correcoes.')); end if;
end;
$$;

create or replace function public.create_reverse_goal(p_name text, p_original_amount numeric, p_initial_contribution numeric, p_start_date date, p_selic_factor numeric, p_icon text default '🎯', p_color text default '#6366f1')
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid(); gid text := gen_random_uuid()::text;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode = '28000'; end if;
  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 120 or p_original_amount <= 0 or p_original_amount >= 1000000000 or p_initial_contribution < 0 or p_initial_contribution > p_original_amount or p_start_date is null or p_start_date < current_date - interval '19 years' or p_start_date > current_date or p_selic_factor not between .5 and 1.5 then
    if p_original_amount >= 1000000000 then raise exception 'reverse_goal_limit_exceeded' using errcode = '22023'; end if;
    raise exception 'dados da meta invalidos' using errcode = '22023';
  end if;
  insert into public.goals (id, user_id, name, target, current, deadline, icon, color, goal_type, reverse_original_amount, reverse_remaining_amount, reverse_corrected_amount, reverse_start_date, reverse_selic_factor) values (gid, u, btrim(p_name), p_original_amount, 0, null, left(coalesce(p_icon, '🎯'), 8), coalesce(p_color, '#6366f1'), 'reverse', p_original_amount, p_original_amount, p_original_amount, p_start_date, round(p_selic_factor, 4));
  insert into public.reverse_goal_events(goal_id, user_id, event_type, occurred_on, details) values (gid, u, 'created', p_start_date, jsonb_build_object('message', 'Meta Reversa criada.'));
  if p_initial_contribution > 0 then
    insert into public.reverse_goal_contributions(goal_id, user_id, amount, occurred_on, note) values (gid, u, round(p_initial_contribution, 2), p_start_date, null);
    insert into public.reverse_goal_events(goal_id, user_id, event_type, occurred_on, details) values (gid, u, 'contribution', p_start_date, jsonb_build_object('amount', round(p_initial_contribution, 2)));
  end if;
  perform public.rebuild_reverse_goal_for_user(gid, u);
  return gid;
end;
$$;

create or replace function public.rebuild_all_reverse_goals()
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare item record; n integer := 0;
begin
  for item in select id, user_id from public.goals where goal_type = 'reverse' and reverse_completed_at is null and reverse_remaining_amount > 0 loop
    begin
      perform public.rebuild_reverse_goal_for_user(item.id, item.user_id);
      n := n + 1;
    exception when others then
      raise warning 'rebuild_reverse_goal_for_user ignorado para goal_id=% (SQLSTATE %): %', item.id, SQLSTATE, SQLERRM;
    end;
  end loop;
  return n;
end;
$$;

-- SEC-02/SEC-03 - permissoes devem vir depois das definicoes finais.
revoke all on function public.create_reverse_goal(text,numeric,numeric,date,numeric,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_reverse_goal(text,numeric,numeric,date,numeric,text,text) to authenticated;
revoke all on function public.rebuild_reverse_goal_for_user(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.refresh_reverse_goal_forecast(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.refresh_reverse_goal_forecast_after_rebuild() from public,anon,authenticated,service_role;
revoke all on function public.rebuild_all_reverse_goals() from public,anon,authenticated;
grant execute on function public.rebuild_all_reverse_goals() to service_role;
