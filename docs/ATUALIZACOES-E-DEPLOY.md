# Guia de Atualizacoes, Deploy e Migracoes

Este documento descreve o processo recomendado para atualizar o Planejador
Financeiro sem apagar dados e com o menor risco possivel de indisponibilidade.

> Este guia trata de **atualizacoes posteriores**. Para criar a primeira
> instalacao, consulte [`IMPLANTACAO-V2.md`](./IMPLANTACAO-V2.md).

## 1. Arquitetura e responsabilidade de cada servico

O aplicativo tem duas partes independentes:

- **Vercel:** compila e hospeda o frontend React/Vite. Um deploy novo substitui
  os arquivos da interface, mas nao apaga dados do Supabase.
- **Supabase:** hospeda autenticacao, banco PostgreSQL, funcoes e politicas RLS.
  Os dados permanecem no mesmo projeto mesmo quando o frontend e atualizado.

O frontend usa as variaveis `VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY`. A chave `anon` e publica por natureza; a seguranca dos
dados depende das politicas RLS definidas no banco.

### Regras que nunca devem ser quebradas

1. Nunca crie outro projeto Supabase para um deploy de producao por engano.
2. Nunca exponha a chave `service_role` no frontend ou em variavel `VITE_*`.
3. Nunca desabilite RLS para contornar um erro.
4. Nunca execute `DROP TABLE`, `TRUNCATE` ou exclusoes em massa sem backup
   validado, plano de reversao e janela de manutencao.
5. Nunca edite uma migracao que ja foi aplicada. Crie uma nova migracao
   corretiva.

## 2. Ambientes recomendados

Mantenha dados reais e testes separados:

| Ambiente | Vercel | Supabase | Dados |
|---|---|---|---|
| Development | computador local | homologacao/local | ficticios |
| Preview | Preview Deployment | homologacao | ficticios |
| Production | dominio oficial | producao | reais |

Na Vercel, configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`
separadamente para **Preview** e **Production** em **Project Settings >
Environment Variables**. Um Preview nao deve apontar para o banco de producao,
pois codigo ainda nao aprovado poderia alterar dados reais.

Depois de modificar uma variavel na Vercel, gere um novo deploy. Variaveis
`VITE_*` sao incorporadas no momento do build.

## 3. Preparacao local

Instale as dependencias e crie o arquivo de ambiente:

```bash
npm ci
copy .env.example .env
```

Preencha `.env` com o projeto Supabase de homologacao. O `.gitignore` impede o
versionamento desse arquivo. Confirme antes de cada commit que nenhuma chave ou
senha foi adicionada ao Git.

Use uma branch para cada mudanca:

```bash
git switch -c feature/nome-da-funcionalidade
npm run dev
```

Antes de enviar ao GitHub:

```bash
npm run deploy:check
git status
```

`deploy:check` compila o frontend e valida nomes/timestamps das migracoes. Ele
tambem alerta sobre SQL de alto risco para revisao humana, mas **nunca se conecta
nem aplica comandos ao banco**.

## 4. Atualizacao somente do frontend

Use este fluxo quando a mudanca utiliza apenas tabelas e campos que ja existem:

1. Desenvolva e teste na branch da funcionalidade.
2. Execute `npm run deploy:check`.
3. Envie a branch ao GitHub e aguarde o Preview Deployment da Vercel.
4. Teste login, leitura, criacao, edicao e exclusao no Preview.
5. Faca merge na branch de producao (normalmente `main`).
6. Aguarde o deployment de Production ficar `Ready`.
7. Execute os testes rapidos da secao 10.

A Vercel constroi uma versao isolada e troca o deployment ativo somente quando
ela esta pronta. Isso evita a substituicao parcial de arquivos e normalmente nao
causa interrupcao perceptivel.

## 5. Atualizacao que modifica o banco

O arquivo `supabase/schema.sql` representa a instalacao completa e o estado
consolidado do banco. Ele nao substitui o historico de atualizacoes.

Para cada alteracao de banco, crie um arquivo incremental em
`supabase/migrations/`, usando UTC e o formato:

```text
YYYYMMDDHHMMSS_descricao_curta.sql
```

Exemplo:

```text
supabase/migrations/20260805133000_add_transaction_favorite.sql
```

O timestamp torna a ordem explicita. Consulte o
[`README de migrations`](../supabase/migrations/README.md) e copie o modelo em
[`supabase/templates/migration.sql.example`](../supabase/templates/migration.sql.example).

### Ordem segura de publicacao

1. Crie a migracao incremental e retrocompativel.
2. Confirme que existe backup/restauracao disponivel.
3. Aplique e teste a migracao no Supabase de homologacao.
4. Teste o frontend novo no Preview apontando para homologacao.
5. Aplique a mesma migracao no Supabase de producao.
6. Execute as verificacoes SQL da migracao.
7. Publique o frontend de producao.
8. Execute os testes rapidos e monitore erros.

O **banco compativel vem antes do frontend que depende dele**. Durante a
publicacao, usuarios podem manter abas antigas abertas; por isso o banco deve
aceitar temporariamente as duas versoes.

### Aplicacao manual controlada

Para equipes pequenas, abra o **SQL Editor** do projeto correto, copie uma
migracao por vez, revise o nome do projeto e execute. Registre no checklist da
versao qual arquivo foi aplicado e quando.

Se o Supabase CLI for adotado, instale-o como dependencia de desenvolvimento do
projeto, conecte explicitamente o ambiente correto e use o fluxo oficial de
`migration`/`db push`. Nao automatize o banco de producao antes de possuir
homologacao, backups e revisao obrigatoria.

## 6. Padrao expandir e contrair

Mudancas destrutivas devem ser divididas em versoes.

### Etapa A — expandir

- adicione tabelas ou colunas;
- use `IF NOT EXISTS` quando fizer sentido;
- deixe colunas novas opcionais ou forneca `DEFAULT` seguro;
- mantenha nomes e campos antigos;
- atualize RLS, grants, indices e validacoes;
- publique codigo capaz de conviver com o formato antigo.

Exemplo seguro:

```sql
alter table public.transactions
  add column if not exists favorite boolean not null default false;
```

### Etapa B — migrar dados e aplicacao

- preencha dados antigos, preferencialmente em lotes se houver muitas linhas;
- publique o frontend que escreve e le o novo formato;
- monitore ate confirmar que a versao esta estavel.

### Etapa C — contrair em uma versao posterior

- remova do frontend qualquer dependencia do campo antigo;
- aguarde o periodo definido pela equipe;
- somente depois remova campos, funcoes ou politicas obsoletas.

Renomear uma coluna de uma vez equivale a remover o nome antigo. Para evitar
quebra, adicione o nome novo, grave temporariamente nos dois campos, migre os
dados e remova o antigo em outra versao.

## 7. Como escrever uma migracao segura

Cada migracao deve:

- ter um objetivo unico e pequeno;
- conter comentario com finalidade e estrategia de reversao;
- ser executada em transacao, quando todas as operacoes permitirem;
- preservar dados existentes;
- manter compatibilidade com o frontend atualmente publicado;
- criar/atualizar RLS para qualquer tabela acessivel pelo frontend;
- conceder apenas as permissoes minimas ao papel `authenticated`;
- incluir consultas de verificacao para executar depois do `COMMIT`.

Valide a estrutura localmente:

```bash
npm run migrations:check
```

Alertas desse comando nao provam que a migracao esta errada nem substituem uma
revisao. Eles destacam operacoes que exigem backup e estrategia explicita.

Antes de aprovar, procure operacoes de alto risco:

```sql
drop table
drop column
truncate
delete from
alter column ... type
alter column ... set not null
```

Elas nao sao sempre proibidas, mas exigem analise de dados, backup e plano
especifico. Um `UPDATE` sem `WHERE` tambem deve ser tratado como operacao em
massa.

## 8. Backup e recuperacao

Antes de migracoes importantes:

1. Verifique no Supabase o recurso de backup disponivel no plano atual.
2. Registre o horario do ultimo backup ou ponto de recuperacao.
3. Para mudancas destrutivas, gere tambem uma exportacao logica (`pg_dump`) por
   uma conexao segura e fora do repositorio.
4. Teste periodicamente a restauracao em um ambiente isolado.
5. Mantenha a exportacao JSON do aplicativo como camada complementar, nao como
   unico backup do banco.

Um backup nao testado nao e garantia de recuperacao. Credenciais e arquivos com
dados financeiros nunca devem ser enviados ao GitHub.

## 9. Rollback

### Problema somente no frontend

No painel da Vercel, abra um deployment anterior estavel e use a opcao de
promover/restaurar esse deployment para Production. Depois corrija a branch sem
reescrever o historico do banco.

### Problema no banco

Prefira uma **nova migracao corretiva**. Nao apague imediatamente uma coluna que
ja recebeu dados da versao nova. Se a falha for grave:

1. interrompa novos deploys;
2. restaure/promova o frontend compativel;
3. avalie uma migracao corretiva ou restauracao do backup/PITR;
4. valide integridade e acesso por RLS;
5. documente o incidente e a correcao.

Nao use automaticamente `down migrations` em producao: desfazer estrutura pode
apagar informacao criada apos a atualizacao.

## 10. Checklist de publicacao

### Antes

- [ ] A mudanca esta em branch e foi revisada.
- [ ] `npm ci` e `npm run deploy:check` terminaram sem erro.
- [ ] Nenhum `.env`, senha, backup ou `service_role` entrou no commit.
- [ ] Existe migracao incremental se a estrutura do banco mudou.
- [ ] A migracao preserva RLS, grants e dados existentes.
- [ ] Backup/restauracao foram confirmados para mudancas de risco.
- [ ] Migracao e frontend foram testados em homologacao/Preview.
- [ ] Preview aponta para homologacao, nao para producao.
- [ ] Ha um deployment anterior conhecido para rollback.

### Durante

- [ ] A migracao foi aplicada no projeto Supabase correto.
- [ ] As consultas de verificacao retornaram o esperado.
- [ ] O deploy da Vercel concluiu com estado `Ready`.
- [ ] Nenhuma variavel de ambiente foi alterada acidentalmente.

### Depois — teste rapido de producao

- [ ] Abrir o aplicativo em janela anonima e fazer login.
- [ ] Confirmar que apenas os dados do usuario atual aparecem.
- [ ] Listar, criar, editar e excluir um registro de teste.
- [ ] Testar a funcionalidade nova.
- [ ] Verificar erros no navegador, Vercel e Supabase.
- [ ] Confirmar que autenticacao/MFA e politicas RLS continuam funcionando.
- [ ] Registrar versao, migracoes aplicadas, horario e responsavel.

## 11. Manutencao do schema consolidado

`supabase/schema.sql` deve continuar capaz de criar uma instalacao nova. Depois
que uma migracao estiver validada em producao, replique sua estrutura final no
schema consolidado, sem copiar comandos temporarios de preenchimento de dados.

Assim:

- instalacoes existentes evoluem por `supabase/migrations/`;
- instalacoes novas usam `supabase/schema.sql`;
- ambos terminam com a mesma estrutura esperada.

Revise essa equivalencia a cada versao que modificar o banco.
