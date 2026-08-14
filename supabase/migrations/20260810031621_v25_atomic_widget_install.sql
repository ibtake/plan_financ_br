-- Widget Scriptable: consumo atômico do código e vínculo único token-código.
alter table public.widget_tokens
  add column if not exists install_code_id uuid references public.widget_install_codes(id);

do $$
begin
  if exists (select 1 from public.widget_tokens where install_code_id is null) then
    raise exception 'widget_tokens possui registros sem install_code_id; limpe ou vincule os tokens antes de aplicar v25';
  end if;
end
$$;

alter table public.widget_tokens
  alter column install_code_id set not null;

create unique index if not exists widget_tokens_install_code_unique
  on public.widget_tokens(install_code_id);

create or replace function public.activate_widget_install_code(p_code_hash text, p_token_hash text)
returns table (install_code_id uuid, user_id uuid)
language sql
security definer
set search_path = public
as $$
  with consumed as (
    update public.widget_install_codes
    set used_at = now()
    where code_hash = p_code_hash
      and used_at is null
      and expires_at > now()
    returning id, user_id
  ), inserted as (
    insert into public.widget_tokens (install_code_id, user_id, token_hash)
    select id, user_id, p_token_hash
    from consumed
    returning install_code_id, user_id
  )
  select install_code_id, user_id
  from inserted;
$$;

revoke all on function public.activate_widget_install_code(text, text) from public, anon, authenticated;
grant execute on function public.activate_widget_install_code(text, text) to service_role;