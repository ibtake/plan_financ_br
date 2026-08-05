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
-- BLOCO 5 - Tabela de auditoria de seguranca
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

-- Usuario le apenas os proprios eventos
drop policy if exists "own events select" on public.security_events;
create policy "own events select"
  on public.security_events for select
  to authenticated
  using (auth.uid() = user_id);

-- Usuario registra eventos apenas em seu proprio nome
drop policy if exists "own events insert" on public.security_events;
create policy "own events insert"
  on public.security_events for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Nao existe policy de UPDATE nem DELETE: o log e imutavel.
-- Sem policy, a RLS bloqueia a operacao por padrao.

grant select, insert on public.security_events to authenticated;


-- =====================================================================
-- BLOCO 6 - Funcao de deteccao de acesso indevido
-- =====================================================================
-- Chamada pelo aplicativo quando o Postgres recusa uma operacao por
-- violacao de RLS. Como a RLS ja bloqueou o acesso, o registro serve
-- para documentar a TENTATIVA - que e justamente o sinal de ataque.
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
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_email text;
begin
  -- Exige usuario autenticado: evita poluicao anonima do log
  if v_uid is null then
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
end;
$$;

revoke all on function public.log_security_event(text, text, jsonb, text) from public;
revoke all on function public.log_security_event(text, text, jsonb, text) from anon;
grant execute on function public.log_security_event(text, text, jsonb, text) to authenticated;


-- =====================================================================
-- BLOCO 7 - Perfis de usuario
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
  using (auth.uid() = id);

drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

grant select, insert, update on public.profiles to authenticated;


-- =====================================================================
-- BLOCO 8 - Categorias
-- =====================================================================

create table if not exists public.categories (
  id          text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  type        text not null,
  color       text not null default '#6366f1',
  icon        text not null default '📁',
  custom      boolean not null default true,
  created_at  timestamptz not null default now(),

  primary key (user_id, id),

  constraint categories_type_check check (type in ('income', 'expense')),
  constraint categories_name_length check (char_length(name) between 1 and 60),
  constraint categories_color_format check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint categories_icon_length check (char_length(icon) <= 8)
);

alter table public.categories enable row level security;
alter table public.categories force row level security;

drop policy if exists "own categories select" on public.categories;
create policy "own categories select"
  on public.categories for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "own categories insert" on public.categories;
create policy "own categories insert"
  on public.categories for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "own categories update" on public.categories;
create policy "own categories update"
  on public.categories for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own categories delete" on public.categories;
create policy "own categories delete"
  on public.categories for delete
  to authenticated using (auth.uid() = user_id);

drop trigger if exists categories_no_owner_change on public.categories;
create trigger categories_no_owner_change
  before update on public.categories
  for each row execute function public.prevent_owner_change();

grant select, insert, update, delete on public.categories to authenticated;


-- =====================================================================
-- BLOCO 9 - Lancamentos
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

  constraint transactions_type_check check (type in ('income', 'expense')),
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

alter table public.transactions enable row level security;
alter table public.transactions force row level security;

drop policy if exists "own transactions select" on public.transactions;
create policy "own transactions select"
  on public.transactions for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "own transactions insert" on public.transactions;
create policy "own transactions insert"
  on public.transactions for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "own transactions update" on public.transactions;
create policy "own transactions update"
  on public.transactions for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own transactions delete" on public.transactions;
create policy "own transactions delete"
  on public.transactions for delete
  to authenticated using (auth.uid() = user_id);

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
-- BLOCO 10 - Orcamentos
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
  to authenticated using (auth.uid() = user_id);

drop policy if exists "own budgets insert" on public.budgets;
create policy "own budgets insert"
  on public.budgets for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "own budgets update" on public.budgets;
create policy "own budgets update"
  on public.budgets for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own budgets delete" on public.budgets;
create policy "own budgets delete"
  on public.budgets for delete
  to authenticated using (auth.uid() = user_id);

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
-- BLOCO 11 - Metas
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
  constraint goals_color_format check (color ~ '^#[0-9a-fA-F]{6}$')
);

alter table public.goals enable row level security;
alter table public.goals force row level security;

drop policy if exists "own goals select" on public.goals;
create policy "own goals select"
  on public.goals for select
  to authenticated using (auth.uid() = user_id);

drop policy if exists "own goals insert" on public.goals;
create policy "own goals insert"
  on public.goals for insert
  to authenticated with check (auth.uid() = user_id);

drop policy if exists "own goals update" on public.goals;
create policy "own goals update"
  on public.goals for update
  to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own goals delete" on public.goals;
create policy "own goals delete"
  on public.goals for delete
  to authenticated using (auth.uid() = user_id);

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
-- BLOCO 12 - Provisionamento automatico de novos usuarios
-- =====================================================================
-- Ao criar a conta, o usuario recebe automaticamente o perfil e as
-- categorias padrao, sem que o front-end precise de permissoes extras.
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
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
-- BLOCO 13 - Exclusao total dos dados do proprio usuario
-- =====================================================================
-- Usada pelo botao "Apagar todos os dados". Restrita ao usuario
-- autenticado: nao aceita parametro de id, logo nao ha como apagar
-- dados de terceiros.
-- =====================================================================

create or replace function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Nao autenticado';
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
-- BLOCO 14 - Verificacao final
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
