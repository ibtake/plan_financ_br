-- Migration: permitir que cada usuario escolha os campos opcionais visiveis ao criar lancamentos.
-- Pre-condicoes: a tabela public.profiles e as politicas RLS de perfil ja existem.
-- Compatibilidade: a coluna possui valor padrao completo; versoes anteriores continuam funcionando.
-- Impacto: nao altera dados financeiros, RLS, grants ou indices existentes.
-- Verificacao: confirme que cada perfil le e atualiza apenas a propria preferencia.
-- Recuperacao: uma migracao corretiva pode restaurar o valor padrao para perfis afetados.

begin;

alter table public.profiles
  add column if not exists transaction_form_fields jsonb not null
    default '{"method": true, "recurrence": true, "installments": true, "tags": true, "note": true, "paid": true}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_transaction_form_fields_check;

alter table public.profiles
  add constraint profiles_transaction_form_fields_check
  check (jsonb_typeof(transaction_form_fields) = 'object');

commit;
