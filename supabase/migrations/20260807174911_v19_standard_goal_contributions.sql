-- Migration: individual contribution ledger for standard goals.
-- Existing aggregate balances are preserved as a labelled historical entry.

begin;

create table if not exists public.standard_goal_contributions (
  id bigint generated always as identity primary key,
  goal_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, goal_id) references public.goals(user_id, id) on delete cascade
);

create index if not exists standard_goal_contributions_goal_date_idx
  on public.standard_goal_contributions (user_id, goal_id, occurred_on desc, id desc);

alter table public.standard_goal_contributions enable row level security;
alter table public.standard_goal_contributions force row level security;

drop policy if exists "own standard goal contributions select" on public.standard_goal_contributions;
create policy "own standard goal contributions select"
  on public.standard_goal_contributions for select to authenticated
  using (auth.uid() = user_id and public.is_token_valid() and public.has_required_aal());

grant select on public.standard_goal_contributions to authenticated;

-- Metas existentes guardavam somente o total. Nao e possivel recuperar as
-- datas reais; este lancamento preserva o saldo e deixa isso explicito.
insert into public.standard_goal_contributions (goal_id, user_id, amount, occurred_on, note)
select g.id, g.user_id, round(g.current, 2), coalesce(g.updated_at::date, current_date), 'Saldo anterior'
from public.goals g
where g.goal_type = 'standard'
  and g.current > 0
  and not exists (
    select 1 from public.standard_goal_contributions c
    where c.user_id = g.user_id and c.goal_id = g.id
  );

create or replace function public.rebuild_standard_goal(p_goal_id text, p_user_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare total numeric(14,2);
begin
  select coalesce(round(sum(amount), 2), 0) into total
  from public.standard_goal_contributions
  where goal_id = p_goal_id and user_id = p_user_id;
  update public.goals set current = total, updated_at = now()
  where id = p_goal_id and user_id = p_user_id and goal_type = 'standard';
end; $$;

create or replace function public.create_standard_goal(
  p_name text, p_target numeric, p_initial_contribution numeric default 0,
  p_deadline date default null, p_icon text default '🎯', p_color text default '#6366f1'
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid(); gid text := gen_random_uuid()::text;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000';
  end if;
  if nullif(btrim(p_name),'') is null or char_length(btrim(p_name)) > 120
     or p_target <= 0 or p_initial_contribution < 0 or p_deadline > current_date + interval '100 years' then
    raise exception 'dados da meta invalidos' using errcode='22023';
  end if;
  insert into public.goals (id,user_id,name,target,current,deadline,icon,color,goal_type)
  values (gid,u,btrim(p_name),round(p_target,2),0,p_deadline,left(coalesce(p_icon,'🎯'),8),coalesce(p_color,'#6366f1'),'standard');
  if p_initial_contribution > 0 then
    insert into public.standard_goal_contributions (goal_id,user_id,amount,occurred_on,note)
    values (gid,u,round(p_initial_contribution,2),current_date,'Aporte inicial');
    perform public.rebuild_standard_goal(gid,u);
  end if;
  return gid;
end; $$;

create or replace function public.add_standard_goal_contribution(
  p_goal_id text, p_amount numeric, p_occurred_on date
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000';
  end if;
  perform 1 from public.goals
  where id=p_goal_id and user_id=u and goal_type='standard' for update;
  if not found then raise exception 'meta nao encontrada' using errcode='P0002'; end if;
  if p_amount <= 0 or p_occurred_on is null or p_occurred_on > current_date then
    raise exception 'aporte invalido' using errcode='22023';
  end if;
  -- Backups antigos restauram somente goals.current. Ao primeiro novo aporte,
  -- transforma esse saldo em um lancamento para que ele nunca seja perdido.
  insert into public.standard_goal_contributions (goal_id,user_id,amount,occurred_on,note)
  select g.id,g.user_id,round(g.current,2),coalesce(g.updated_at::date,current_date),'Saldo restaurado'
  from public.goals g
  where g.id=p_goal_id and g.user_id=u and g.current>0
    and not exists (select 1 from public.standard_goal_contributions c where c.goal_id=g.id and c.user_id=g.user_id);
  insert into public.standard_goal_contributions (goal_id,user_id,amount,occurred_on)
  values (p_goal_id,u,round(p_amount,2),p_occurred_on);
  perform public.rebuild_standard_goal(p_goal_id,u);
end; $$;

create or replace function public.update_standard_goal_contribution(
  p_contribution_id bigint, p_amount numeric, p_occurred_on date
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid(); gid text;
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000';
  end if;
  select c.goal_id into gid from public.standard_goal_contributions c
  join public.goals g on g.user_id=c.user_id and g.id=c.goal_id
  where c.id=p_contribution_id and c.user_id=u and g.goal_type='standard' for update;
  if not found then raise exception 'aporte indisponivel para edicao' using errcode='P0002'; end if;
  if p_amount <= 0 or p_occurred_on is null or p_occurred_on > current_date then
    raise exception 'aporte invalido' using errcode='22023';
  end if;
  update public.standard_goal_contributions
  set amount=round(p_amount,2), occurred_on=p_occurred_on, updated_at=now()
  where id=p_contribution_id and user_id=u;
  perform public.rebuild_standard_goal(gid,u);
end; $$;

create or replace function public.update_standard_goal_metadata(
  p_goal_id text, p_name text, p_target numeric, p_deadline date,
  p_icon text default '🎯', p_color text default '#6366f1'
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null or not public.is_token_valid() or not public.has_required_aal() then
    raise exception 'sessao invalida ou verificacao MFA necessaria' using errcode='28000';
  end if;
  if nullif(btrim(p_name),'') is null or char_length(btrim(p_name)) > 120
     or p_target <= 0 or p_deadline > current_date + interval '100 years' then
    raise exception 'dados da meta invalidos' using errcode='22023';
  end if;
  update public.goals
  set name=btrim(p_name), target=round(p_target,2), deadline=p_deadline,
      icon=left(coalesce(p_icon,'🎯'),8), color=coalesce(p_color,'#6366f1'), updated_at=now()
  where id=p_goal_id and user_id=u and goal_type='standard';
  if not found then raise exception 'meta nao encontrada' using errcode='P0002'; end if;
end; $$;

revoke all on function public.rebuild_standard_goal(text,uuid) from public,anon,authenticated;
revoke all on function public.create_standard_goal(text,numeric,numeric,date,text,text) from public,anon;
revoke all on function public.add_standard_goal_contribution(text,numeric,date) from public,anon;
revoke all on function public.update_standard_goal_contribution(bigint,numeric,date) from public,anon;
revoke all on function public.update_standard_goal_metadata(text,text,numeric,date,text,text) from public,anon;
grant execute on function public.create_standard_goal(text,numeric,numeric,date,text,text) to authenticated;
grant execute on function public.add_standard_goal_contribution(text,numeric,date) to authenticated;
grant execute on function public.update_standard_goal_contribution(bigint,numeric,date) to authenticated;
grant execute on function public.update_standard_goal_metadata(text,text,numeric,date,text,text) to authenticated;

commit;