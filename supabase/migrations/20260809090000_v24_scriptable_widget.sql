-- Widget Scriptable: códigos de instalação temporários e tokens somente leitura.
create table if not exists public.widget_install_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.widget_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists widget_install_codes_user_idx on public.widget_install_codes(user_id, created_at desc);
create index if not exists widget_tokens_user_idx on public.widget_tokens(user_id, created_at desc);

alter table public.widget_install_codes enable row level security;
alter table public.widget_tokens enable row level security;

revoke all on public.widget_install_codes, public.widget_tokens from anon, authenticated;
