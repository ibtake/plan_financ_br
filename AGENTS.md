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


## Code exploration policy

Call the jcodemunch_guide tool and strictly follow its instructions.

## jCodeMunch usage

Use jCodeMunch as the primary mechanism for understanding and exploring this codebase.

Before reading source files directly:

1. Search the jCodeMunch index.
2. Search for relevant symbols.
3. Retrieve only the required functions, classes, methods, or definitions.
4. Prefer symbol-level source retrieval instead of reading complete files.
5. Use dependency/call/reference analysis before modifying shared code.
6. Read complete source files only when jCodeMunch cannot provide enough context.

Avoid recursively reading directories or opening many source files merely to understand the architecture.

After significant source-code changes, ensure the jCodeMunch index is refreshed when necessary.

The goal is to minimize unnecessary context usage while maintaining enough information to make safe code changes.
