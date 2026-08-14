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