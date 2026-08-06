-- migration: adiciona target_percentage as categorias
--
-- OBJETIVO
--   Guardar a meta percentual esperada de cada categoria de despesa/reinvestimento
--   (REQ 6 - Esperado vs Realizado). Categorias de receita ignoram o campo.
--
-- PRE-CONDICOES
--   - Tabela public.categories existe.
--
-- COMPATIBILIDADE
--   Retrocompativel. Coluna nova com DEFAULT 0 e NOT NULL: linhas existentes
--   recebem 0 automaticamente. O frontend antigo ignora a coluna.
--
-- IMPACTO EM RLS/GRANTS/INDICES
--   Nenhum. As policies por linha ja cobrem a coluna nova. Sem novos grants.
--
-- VERIFICACAO POSTERIOR
--   select target_percentage from categories limit 1;  -> 0 nas linhas antigas.
--   update com valor fora de [0,100] deve ser rejeitado pela CHECK.
--
-- RECUPERACAO
--   Em caso de problema, manter a coluna (inofensiva). Remocao so em migracao
--   posterior planejada (contrair), com backup.

begin;

alter table public.categories
  add column if not exists target_percentage numeric not null default 0;

alter table public.categories
  drop constraint if exists categories_target_percentage_check;
alter table public.categories
  add constraint categories_target_percentage_check
  check (target_percentage >= 0 and target_percentage <= 100);

commit;
