# Manual de atualização — 6 de agosto de 2026

Este manual atualiza uma instalação existente sem apagar dados. Não aplique
`supabase/schema.sql` em um projeto já em uso: ele serve somente para primeira
instalação. As alterações desta versão são: tipo **Despesa Reinvestida**, metas
percentuais de categoria, importação transacional, retenção de sete dias de
eventos de segurança e categorias padrão de reinvestimento.

## 1. Preparação

1. Identifique os projetos corretos: Supabase de **homologação** para Preview e
   Supabase de **produção** para o site oficial. Não use produção para testar.
2. Na Vercel, confirme que as variáveis `VITE_SUPABASE_URL` e
   `VITE_SUPABASE_ANON_KEY` de Preview apontam para homologação; as de
   Production, para produção. Não crie nem use `service_role` no frontend.
3. Confirme que há backup/PITR disponível no Supabase e registre o horário. A
   migração V09 remove permanentemente eventos de segurança com mais de sete
   dias quando o usuário registrar um novo evento.
4. No repositório, execute `npm ci` e `npm run deploy:check`. Não envie
   `.env`, `dist`, `node_modules`, dumps ou `.vercel` ao Git.

## 2. Aplicar no Supabase de homologação

No **SQL Editor** do projeto de homologação, consulte o histórico de
migrações/registre quais arquivos já foram aplicados. Execute somente os que
ainda não constarem no ambiente, sempre um por vez e nesta ordem:

1. `20260806004851_v04_log_rate_limit.sql` — pré-requisito da retenção.
2. `20260806005714_v05_replace_my_data.sql` — RPC de restauração transacional.
3. `20260806010000_v06_add_reinvested_type.sql` — libera o novo tipo.
4. `20260806010500_v07_add_category_target_percentage.sql` — cria a coluna de meta.
5. `20260806011000_v08_replace_my_data_target_percentage.sql` — faz a RPC preservar a meta.
6. `20260806011500_v09_security_events_retention.sql` — retenção de sete dias.
7. `20260806012000_v10_default_reinvested_categories.sql` — cria Aportes e Outros reinvestimentos para contas existentes e novas.

Não reaplique um arquivo que já tenha sido executado e não altere arquivos de
migração. Em cada execução, confira que o SQL concluiu sem erro antes de seguir.

Verificações no SQL Editor:

```sql
select type, count(*)
from public.categories
group by type
order by type;

select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'categories'
  and column_name = 'target_percentage';

select routine_name
from information_schema.routines
where routine_schema = 'public'
  and routine_name = 'replace_my_data';
```

Com uma conta de teste, crie um lançamento reinvestido, importe um backup
válido e confirme que as metas percentuais são preservadas. Confirme também que
cada usuário só vê os próprios dados; RLS deve permanecer ativa.

## 3. Publicar o frontend

1. Envie os fontes ao repositório e aguarde o **Preview Deployment** da Vercel.
2. Teste o Preview conectado à homologação: login, criação/edição/exclusão,
   reatribuição ao excluir categoria, reinvestimento, meta até 100%, gráfico,
   importação JSON, popover mobile, favicon e `robots.txt`.
3. Após aprovação, aplique no Supabase de produção somente as migrações que
   ainda não estiverem registradas, na mesma ordem da seção 2. Execute as
   verificações SQL novamente.
4. Faça merge/publicação para Production na Vercel e aguarde o estado `Ready`.
5. Em janela anônima, repita o teste rápido em produção e verifique logs da
   Vercel e do Supabase.

O banco vem antes do frontend: as migrações são retrocompatíveis, permitindo
que abas antigas continuem funcionando durante a publicação.

## 4. Rollback

Se o problema for só de interface, promova na Vercel o deployment estável
anterior. Não reverta nem exclua estrutura do banco automaticamente.

Se o problema envolver banco, interrompa novos deploys, mantenha/promova um
frontend compatível e crie uma **nova migração corretiva**. A recuperação de
eventos apagados pela retenção de sete dias depende do backup/PITR; por isso o
backup precisa ser confirmado antes de V09.

## 5. Primeira instalação

Para um projeto Supabase novo, use o fluxo de `docs/IMPLANTACAO-V2.md` e o
`supabase/schema.sql` consolidado. Não misture esse fluxo com as migrações de
uma instalação existente.
