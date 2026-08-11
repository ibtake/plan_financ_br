begin;

-- Mantem a validacao de tokens antigos alinhada ao schema-base.
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

commit;