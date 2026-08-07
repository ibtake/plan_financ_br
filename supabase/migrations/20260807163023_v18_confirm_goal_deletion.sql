begin;

create or replace function public.delete_goal(p_goal_id text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid:=auth.uid(); deleted boolean:=false;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000';
  end if;
  if nullif(btrim(p_goal_id),'') is null then
    raise exception 'identificador de meta invalido' using errcode='22023';
  end if;

  delete from public.goals
  where user_id=u and id=p_goal_id
  returning true into deleted;

  if not found then
    raise exception 'meta nao encontrada para exclusao' using errcode='P0002';
  end if;
  return deleted;
end; $$;

revoke all on function public.delete_goal(text) from public,anon;
grant execute on function public.delete_goal(text) to authenticated;

commit;