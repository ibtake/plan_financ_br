begin;

-- Corrige a perda de marcacoes quando duas abas atualizam o mesmo lancamento.
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
  if p_occurrence_index >= v_transaction.installments then
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

commit;