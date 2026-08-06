-- migration: categorias padrao do tipo reinvestido
--
-- OBJETIVO
--   O REQ 3 criou o tipo 'reinvested', mas nenhuma categoria desse tipo existia.
--   Sem categoria o usuario nao consegue escolher o tipo no formulario de
--   lancamento. Esta migracao:
--     1. cria duas categorias padrao ('aportes' e 'outros-ri') para todos os
--        usuarios que ja possuem conta;
--     2. atualiza handle_new_user para que novas contas ja nasçam com elas.
--   'outros-ri' e o destino de reatribuicao quando uma categoria reinvestida
--   personalizada e excluida (fallbackCategoryId no frontend).
--
-- PRE-CONDICOES
--   - Migracao v06 aplicada (constraint categories_type_check aceita
--     'reinvested'). Aplicar v06 ANTES desta.
--   - Migracao v07 aplicada (coluna target_percentage com default 0).
--
-- COMPATIBILIDADE
--   Retrocompativel e idempotente. Usa on conflict do nothing, entao reexecutar
--   nao duplica nem sobrescreve personalizacoes. Nao altera nenhuma linha
--   existente. O frontend antigo simplesmente ignora categorias de tipo que
--   ele nao conhece.
--
-- IMPACTO EM RLS/GRANTS/INDICES
--   Nenhuma mudanca de RLS ou grants. O insert roda como owner da migracao
--   (fora do contexto RLS do usuario), o que e necessario para provisionar
--   todos os usuarios de uma vez. Cada linha recebe o user_id correto, entao o
--   isolamento por usuario permanece intacto.
--
-- VERIFICACAO POSTERIOR
--   select count(*) from public.categories where type = 'reinvested';
--   -> deve ser 2 x (numero de usuarios em auth.users).
--   Criar uma conta nova e conferir que ela tambem recebeu as duas.
--
-- RECUPERACAO
--   delete from public.categories
--   where type = 'reinvested' and custom = false
--     and not exists (select 1 from public.transactions t
--                     where t.category_id = categories.id
--                       and t.user_id = categories.user_id);
--   (remove apenas as categorias padrao sem lancamentos vinculados)

begin;

-- 1. Usuarios existentes
insert into public.categories (id, user_id, name, type, color, icon, custom)
select 'aportes', u.id, 'Aportes e investimentos', 'reinvested', '#8b5cf6', '📈', false
from auth.users u
on conflict (user_id, id) do nothing;

insert into public.categories (id, user_id, name, type, color, icon, custom)
select 'outros-ri', u.id, 'Outros reinvestimentos', 'reinvested', '#a855f7', '📦', false
from auth.users u
on conflict (user_id, id) do nothing;

-- 2. Novas contas: mesmo corpo do BLOCO 14, com as duas linhas novas
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

commit;
