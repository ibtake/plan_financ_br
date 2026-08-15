# Regras Obrigatorias para Agentes de IA

Este arquivo se aplica a todo o repositorio. Antes de analisar, editar ou
publicar este projeto, leia integralmente, nesta ordem:

1. `AGENTS.md` (este arquivo);
2. `README.md`;
3. `docs/ATUALIZACOES-E-DEPLOY.md`;
4. `supabase/migrations/README.md`, se a tarefa tocar banco, autenticacao, RLS,
   funcoes, indices, constraints ou dados;
5. `docs/IMPLANTACAO-V2.md` somente para uma primeira instalacao.

Se uma solicitacao conflitar com estas regras, pare e explique o risco antes de
alterar arquivos ou servicos externos.

## Objetivo permanente

Atualizar o Planejador Financeiro preservando:

- todos os dados existentes no Supabase;
- isolamento por usuario e politicas RLS;
- compatibilidade entre abas antigas e o frontend novo;
- possibilidade de rollback do frontend;
- segredos fora do Git e do bundle Vite;
- funcionamento durante a publicacao, sempre que tecnicamente possivel.

## Escopo de trabalho e autorizacao de pastas

1. Trabalhe exclusivamente dentro de `/app/` por padrao.
2. Nao leia, crie, copie, altere, mova ou exclua arquivos fora de `/app/` sem
   ordem expressa do usuario para a pasta ou arquivo externo envolvido.
3. Em especial, nunca altere `release/`, `arquivo-documentacao/` ou qualquer
   outra pasta paralela por inferencia, mesmo que exista uma versao relacionada
   do aplicativo. Aguarde autorizacao explicita para cada operacao fora de
   `/app/`.
4. Quando uma tarefa em `/app/` exigir documentacao ou uma copia de release,
   conclua a alteracao no aplicativo e informe quais arquivos externos seriam
   necessarios; somente execute essas etapas apos a autorizacao expressa.

## Regras de seguranca

1. Nunca leia, imprima, versione ou exponha valores de `.env`, senhas, dumps,
   tokens, JWT secrets ou chaves privadas.
2. Nunca coloque `service_role` em `src/`, `VITE_*`, Vercel frontend ou codigo
   executado no navegador. O frontend usa somente URL e chave `anon`.
3. Nunca desabilite RLS para corrigir acesso. Toda tabela acessada pelo app deve
   manter RLS e politicas restritas ao usuario autenticado.
4. Nunca execute comandos no Supabase ou Vercel sem autorizacao explicita e sem
   confirmar o ambiente de destino. Preview deve usar homologacao; Production,
   o projeto de producao.
5. Nunca aplique `supabase/schema.sql` sobre uma instalacao existente. Esse
   arquivo serve para primeira instalacao e como schema consolidado.
6. Nunca altere uma migracao ja aplicada. Crie outra migracao corretiva.
7. Nunca use `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, exclusao em massa ou
   alteracao incompativel sem backup validado, plano de recuperacao e aprovacao
   explicita do responsavel.
8. Nunca remova ou reverta mudancas existentes do usuario que nao pertencam a
   tarefa atual.

## Fluxo obrigatorio para qualquer atualizacao

1. Inspecione os arquivos relacionados e identifique se a mudanca e apenas de
   frontend ou se altera o contrato do banco.
2. Implemente em mudanca pequena e retrocompativel, seguindo os padroes atuais.
3. Se houver banco, crie um SQL incremental em `supabase/migrations/` no formato
   `YYYYMMDDHHMMSS_descricao_em_snake_case.sql`.
4. Para banco, siga expandir -> migrar -> contrair. O banco compativel deve ser
   publicado antes do frontend que depende dele; remocoes ficam para uma versao
   posterior.
5. Atualize `supabase/schema.sql` apenas com o estado consolidado final e somente
   depois que a migracao correspondente estiver validada.
   Toda migration ou RPC nova deve atualizar o `schema.sql` na mesma alteração;
   `npm run schema:check` bloqueia o check quando objetos de migrations faltam.
6. Execute `npm run deploy:check` antes de considerar a tarefa concluida.
7. Informe quais arquivos mudaram, quais testes passaram, se existe migracao,
   a ordem de publicacao e os passos de rollback.

## Requisitos para migracoes

Toda migracao deve ser pequena, preservar dados e documentar:

- objetivo;
- pre-condicoes;
- compatibilidade com a versao publicada;
- impacto em RLS, grants, indices e constraints;
- verificacao posterior;
- estrategia de recuperacao.

Teste primeiro em homologacao. A aplicacao em producao e uma etapa humana e
controlada, salvo se o usuario autorizar explicitamente uma automacao ja
protegida por revisao e backup.

## Publicacao e rollback

- Nao inclua `node_modules/`, `dist/`, `.env`, `.vercel/`, `.supabase/`, logs,
  dumps ou arquivos de editor no upload ao GitHub.
- Use Preview Deployment e homologacao antes do merge em producao.
- Para falha de frontend, restaure/promova o deployment estavel anterior na
  Vercel.
- Para falha de banco, prefira uma nova migracao corretiva. Nao tente apagar
  automaticamente dados ou estrutura criada pela versao nova.
- Depois da publicacao, teste login, isolamento por usuario, leitura, criacao,
  edicao, exclusao e a funcionalidade alterada.

## Criterio de conclusao

Uma atualizacao so esta pronta quando o build e a validacao de migracoes passam,
nenhum segredo ou artefato local foi incluido, a compatibilidade foi revisada e
o procedimento de publicacao/rollback foi informado. Nao declare que o banco ou
a producao foram atualizados se apenas os arquivos locais foram modificados.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).


## Codebase navigation

Always use Graphify before broad codebase exploration.

For questions involving architecture, dependencies, database relationships,
business logic, components, functions, or cross-file behavior:

1. Query Graphify first.
2. Use the graph results to identify the smallest relevant set of files.
3. Read only those files or specific code regions.
4. Avoid broad grep/search operations when Graphify can answer the question.
5. Do not read graphify-out/graph.json in full.
6. Prefer targeted `graphify query` and `graphify explain` commands.
7. Fall back to direct file search only when Graphify lacks the required information.
