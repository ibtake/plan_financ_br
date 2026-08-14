# Migracoes do Supabase

Este diretorio guarda, em ordem, todas as alteracoes incrementais aplicadas a
uma instalacao existente do Planejador Financeiro.

O arquivo `../schema.sql` e usado para a **primeira instalacao**. Nao copie o
schema inteiro para este diretorio e nao o reaplique como substituto de uma
migracao incremental.

## Nome dos arquivos

Use timestamp UTC seguido de uma descricao curta em ingles ou portugues sem
acentos:

```text
YYYYMMDDHHMMSS_descricao.sql
```

Exemplo:

```text
20260805133000_add_transaction_favorite.sql
```

O timestamp deve ser unico e posterior ao da ultima migracao.

## Regras

1. Uma migracao aplicada e imutavel. Para corrigir, crie outro arquivo.
2. Uma migracao deve ter um unico objetivo e preservar os dados.
3. Use o padrao expandir/migrar/contrair para mudancas incompativeis.
4. Teste primeiro em um projeto Supabase de homologacao.
5. Aplique no banco antes de publicar o frontend que depende da alteracao.
6. Confirme RLS, grants, indices, constraints e dados depois da execucao.
7. Nunca salve credenciais, dumps ou dados reais neste diretorio.

## Criar uma migracao

1. Copie `../templates/migration.sql.example` para este diretorio.
2. Renomeie usando o timestamp UTC e uma descricao.
3. Remova os exemplos e escreva somente a alteracao necessaria.
4. Preencha pre-condicoes, compatibilidade e estrategia de reversao.
5. Teste a migracao sobre uma copia/homologacao que represente producao.
6. Registre a aplicacao conforme o guia
   [`docs/ATUALIZACOES-E-DEPLOY.md`](../../docs/ATUALIZACOES-E-DEPLOY.md).

Valide nomes, timestamps e alertas de operacoes de risco antes de publicar:

```bash
npm run migrations:check
```

Esse comando apenas le os arquivos locais. Ele nao se conecta ao Supabase e nao
executa SQL.

O arquivo de modelo termina em `.example` para nao ser interpretado como uma
migracao executavel por ferramentas automaticas.

## Transacoes

Use `begin`/`commit` quando todas as instrucoes forem transacionais. Algumas
operacoes PostgreSQL podem exigir execucao fora de uma transacao; nesses casos,
documente a razao e uma recuperacao segura no proprio arquivo.

Nao inclua `rollback` no final de uma migracao real: ele desfaria a alteracao.
`rollback` deve ser usado apenas durante testes ou quando uma instrucao falha
antes do `commit`.
