-- Consome um refresh token uma unica vez, mesmo sob concorrencia.
create or replace function public.rotate_widget_refresh_token(
  p_current_refresh_token_hash text,
  p_token_hash text,
  p_refresh_token_hash text,
  p_access_expires_at timestamptz
)
returns table (user_id uuid)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.widget_tokens
  set token_hash = p_token_hash,
      refresh_token_hash = p_refresh_token_hash,
      access_expires_at = p_access_expires_at,
      last_used_at = now()
  where refresh_token_hash = p_current_refresh_token_hash
    and revoked_at is null
    and refresh_expires_at > now()
  returning widget_tokens.user_id;
$$;

revoke all on function public.rotate_widget_refresh_token(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.rotate_widget_refresh_token(text, text, text, timestamptz)
  to service_role;
