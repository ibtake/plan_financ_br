-- migration: adiciona o tipo "reinvested" (Despesa Reinvestida)
--
-- OBJETIVO
--   Permitir um terceiro tipo de categoria/lancamento alem de income/expense.
--   "reinvested" e uma saida de liquidez que NAO e consumo: acumula patrimonio
--   e entra no calculo da taxa de poupanca.
--
-- PRE-CONDICOES
--   - Constraints categories_type_check e transactions_type_check existem e
--     hoje aceitam apenas ('income','expense').
--
-- COMPATIBILIDADE
--   Retrocompativel. Amplia o dominio aceito (nunca restringe). Linhas
--   existentes (income/expense) permanecem validas. O frontend antigo continua
--   funcionando pois nunca gera o valor novo.
--
-- IMPACTO EM RLS/GRANTS/INDICES
--   Nenhum. Apenas troca duas CHECK constraints pelo mesmo nome com dominio maior.
--
-- VERIFICACAO POSTERIOR
--   insert de teste com type='reinvested' deve ser aceito; type invalido, rejeitado.
--
-- RECUPERACAO
--   Reverter recriando a constraint antiga com o dominio ('income','expense'),
--   desde que nao existam linhas 'reinvested' (migrar essas linhas antes).

begin;

alter table public.categories
  drop constraint if exists categories_type_check;
alter table public.categories
  add constraint categories_type_check
  check (type in ('income', 'expense', 'reinvested'));

alter table public.transactions
  drop constraint if exists transactions_type_check;
alter table public.transactions
  add constraint transactions_type_check
  check (type in ('income', 'expense', 'reinvested'));

commit;
