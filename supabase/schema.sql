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
  c_grace        constant bigint := 10;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return false;
  end if;

  -- "iat" = momento de emissao do token, em segundos Unix
  v_token_iat := coalesce((auth.jwt() ->> 'iat')::bigint, 0);
  if v_token_iat = 0 then
    return false;
  end if;

  select updated_at into v_user_updated
  from auth.users
  where id = v_uid;

  -- Sem registro de updated_at nao ha o que comparar: nao bloqueia o acesso
  if v_user_updated is null then
    return true;
  end if;

  -- floor() evita o arredondamento para cima do cast direto a bigint, que
  -- tornaria falso um token emitido no mesmo segundo da alteracao.
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
      'suspicious_activity'
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
  p_severity   text default 'info',
  p_details    jsonb default '{}'::jsonb,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp  -- CORRECAO 1: protecao contra schema shadowing
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
  v_event_count integer;
begin
  -- Exige usuario autenticado: evita poluicao anonima do log
  if v_uid is null then
    return;
  end if;

  -- CORRECAO 3: Rate limiting - conta eventos na ultima hora
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
  )
  values (
    v_uid,
    p_event_type,
    coalesce(p_severity, 'info'),
    v_email,
    left(coalesce(p_user_agent, ''), 400),
    coalesce(p_details, '{}'::jsonb)
  );

  -- V-09 (REQ 8): retencao de 7 dias. Restrito ao proprio usuario e apoiado
  -- no indice (user_id, created_at desc), sem varredura da tabela.
  delete from public.security_events
  where user_id = v_uid
    and created_at < now() - interval '7 days';
end;
$$;

revoke all on function public.log_security_event(text, text, jsonb, text) from public;
revoke all on function public.log_security_event(text, text, jsonb, text) from anon;
grant execute on function public.log_security_event(text, text, jsonb, text) to authenticated;


-- =====================================================================
-- BLOCO 9 - Perfis de usuario
-- =====================================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  theme       text not null default 'light',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint profiles_theme_check check (theme in ('light', 'dark')),
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


-- =====================================================================
-- BLOCO 13.1 - Restauracao transacional de backup
-- =====================================================================
-- V-05/V-08: usada pelo frontend ao importar um backup. A substituicao das
-- colecoes ocorre em uma unica transacao: se qualquer insert falhar, o
-- PostgreSQL desfaz tudo e os dados anteriores do usuario permanecem intactos.
-- A funcao usa o usuario autenticado, nunca um user_id recebido do navegador,
-- e repete as verificacoes de token e AAL/MFA porque SECURITY DEFINER ignora RLS.

create or replace function public.replace_my_data(p_data jsonb)
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

  delete from public.transactions where user_id = v_uid;
  delete from public.budgets where user_id = v_uid;
  delete from public.goals where user_id = v_uid;
  delete from public.categories where user_id = v_uid;

  insert into public.categories (user_id, id, name, icon, color, type, target_percentage)
  select v_uid, x.id, x.name, x.icon, x.color, x.type, coalesce(x.target_percentage, 0)
  from jsonb_to_recordset(p_data->'categories')
    as x(id text, name text, icon text, color text, type text, target_percentage numeric);

  insert into public.transactions (
    user_id, id, type, description, amount, category_id, date, method,
    paid, recurrence, recurrence_end, installments, tags, note,
    paid_occurrences, created_at, updated_at
  )
  select
    v_uid, x.id, x.type, x.description, x.amount, x.category_id, x.date, x.method,
    x.paid, x.recurrence, x.recurrence_end, x.installments, x.tags, x.note,
    x.paid_occurrences, coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(p_data->'transactions')
    as x(
      id text, type text, description text, amount numeric, category_id text,
      date date, method text, paid boolean, recurrence text, recurrence_end date,
      installments integer, tags text[], note text, paid_occurrences jsonb,
      created_at timestamptz, updated_at timestamptz
    );

  insert into public.budgets (user_id, category_id, limit_amount, created_at, updated_at)
  select v_uid, x.category_id, x.limit_amount,
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(p_data->'budgets')
    as x(category_id text, limit_amount numeric, created_at timestamptz, updated_at timestamptz);

  insert into public.goals (
    user_id, id, name, target, current, deadline, icon, color, created_at, updated_at
  )
  select v_uid, x.id, x.name, x.target, x.current, x.deadline, x.icon, x.color,
    coalesce(x.created_at, now()), coalesce(x.updated_at, now())
  from jsonb_to_recordset(p_data->'goals')
    as x(
      id text, name text, target numeric, current numeric, deadline date,
      icon text, color text, created_at timestamptz, updated_at timestamptz
    );
end;
$$;

revoke execute on function public.replace_my_data(jsonb) from public, anon;
grant execute on function public.replace_my_data(jsonb) to authenticated;


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
    -- V-10 (REQ 3): categorias do tipo reinvestido, para que o usuario consiga
    -- lancar reinvestimento sem precisar cadastrar categoria antes
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

  delete from public.transactions where user_id = v_uid;
  delete from public.budgets      where user_id = v_uid;
  delete from public.goals        where user_id = v_uid;
  delete from public.categories   where user_id = v_uid;

  insert into public.security_events (user_id, event_type, severity, details)
  values (v_uid, 'bulk_delete', 'warning',
          jsonb_build_object('scope', 'all_financial_data'));
end;
$$;

revoke all on function public.delete_my_data() from public;
revoke all on function public.delete_my_data() from anon;
grant execute on function public.delete_my_data() to authenticated;


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
