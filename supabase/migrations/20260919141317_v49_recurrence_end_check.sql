-- =====================================================================
-- Migration: v49 - CHECK de intervalo invertido em public.transactions (AUDT-027)
-- Created at (UTC): 2026-09-19 14:13:17
--
-- Objetivo:
--   public.transactions aceitava recurrence_end anterior a date. O motor de
--   recorrencia (src/utils/recurrence.js, afterRecurrenceEnd) compara por data e
--   descarta toda ocorrencia posterior ao fim, entao o mes inicial ja vinha
--   vazio e o lancamento ficava gravado sem aparecer em lista nenhuma, sem
--   caminho de correcao pela interface.
--
-- Pre-condicoes:
--   - public.transactions existente e sem a constraint
--     transactions_recurrence_end_check;
--   - linhas antigas invertidas permanecem aceitas nesta migration (NOT VALID):
--     o inventario, o reparo e o VALIDATE CONSTRAINT ficam numa migration
--     posterior, depois da conferencia em homologacao.
--
-- Compatibilidade:
--   - o frontend publicado continua funcionando: nenhuma coluna, policy,
--     indice ou assinatura de funcao muda, e o formulario e o import ja barram
--     o intervalo invertido no cliente (recurrenceEndBeforeStart);
--   - o CHECK NOT VALID passa a valer para insert e update novos; restauros
--     (replace_my_data) que tragam intervalo invertido falham com 23514 em vez
--     de gravar lancamento invisivel.
--
-- Recuperacao:
--   - migration corretiva que remove a constraint; nenhum dado e reescrito.
-- =====================================================================

begin;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'transactions_recurrence_end_check'
      and conrelid = 'public.transactions'::regclass
  ) then
    alter table public.transactions
      add constraint transactions_recurrence_end_check
      check (recurrence_end is null or recurrence_end >= date) not valid;
  end if;
end;
$$;

commit;

-- POST-CHECKS (execute e confira depois do commit):
--
-- select conname, convalidated
-- from pg_constraint
-- where conrelid = 'public.transactions'::regclass
--   and conname = 'transactions_recurrence_end_check';
--
-- select count(*) as linhas_invertidas
-- from public.transactions
-- where recurrence_end is not null and recurrence_end < date;
--
-- Depois do reparo das linhas inventariadas, a migration seguinte roda
-- `alter table public.transactions validate constraint transactions_recurrence_end_check;`
