# DinDin 10!

Aplicação web para organizar receitas, despesas, orçamentos e metas financeiras mês a mês. A autenticação e os dados de cada usuário são armazenados no Supabase e protegidos por Row Level Security (RLS).

> **Para agentes de IA:** antes de analisar ou alterar o projeto, leia e siga
> obrigatoriamente [`AGENTS.md`](AGENTS.md).

## Recursos

- Dashboard com saldo, receitas, despesas, taxa de poupança e pendências
- Gráficos por categoria, histórico mensal e evolução acumulada
- Cadastro, edição, duplicação e exclusão de lançamentos
- Filtros, ordenação e exportação CSV da lista exibida
- Lançamentos recorrentes e compras parceladas
- Controle independente de pago ou pendente por ocorrência
- Orçamento por categoria com alertas de limite
- Metas financeiras com aportes e prazos
- Categorias personalizadas
- Insights automáticos sobre gastos e evolução mensal
- Tema claro e escuro
- Backup e restauração em JSON
- Dados de demonstração opcionais
- Autenticação, MFA e histórico de eventos de segurança
- Sincronização dos dados com PostgreSQL/Supabase

## Executar localmente

Requer Node.js 18 ou superior e um projeto Supabase configurado.

```bash
npm ci
copy .env.example .env
npm run dev
```

Preencha no `.env` a URL e a chave `anon` do projeto Supabase de desenvolvimento ou homologação. Nunca use a chave `service_role` no frontend.

Abra o endereço exibido pelo Vite, normalmente `http://localhost:5173`.

Para gerar a versão de produção:

```bash
npm run build
npm run preview
```

Antes de abrir um pull request ou publicar:

```bash
npm run deploy:check
```

Esse comando gera o build de produção e valida a convenção dos arquivos de
migração. Ele não aplica alterações ao Supabase.

## Armazenamento e privacidade

Perfis, lançamentos, categorias, orçamentos, metas e eventos de segurança ficam no Supabase. As políticas RLS restringem cada usuário às próprias informações. A sessão de autenticação é mantida no navegador, e a exportação JSON continua disponível como backup complementar do usuário.

O deploy do frontend na Vercel não apaga os dados do Supabase. Mudanças de banco devem ser feitas por migrações incrementais e testadas primeiro em homologação.

## Implantação e atualizações

- Primeira instalação: [`docs/IMPLANTACAO-V2.md`](docs/IMPLANTACAO-V2.md)
- Atualizações sem perda de dados: [`docs/ATUALIZACOES-E-DEPLOY.md`](docs/ATUALIZACOES-E-DEPLOY.md)
- Migrações do banco: [`supabase/migrations/README.md`](supabase/migrations/README.md)
- Administração de usuários: [`docs/MANUAL-ADMINISTRACAO-USUARIOS.md`](docs/MANUAL-ADMINISTRACAO-USUARIOS.md)

Para atualizações de frontend, utilize os Preview Deployments da Vercel. Para alterações de tabelas, colunas, funções ou RLS, adicione uma nova migração versionada em `supabase/migrations/`; não edite uma migração que já tenha sido aplicada.

O cadastro público está desativado. Novas contas são criadas na aba
**Configurações** por um administrador autorizado por UUID, com MFA, através da
Edge Function `admin-users`.

## Upload pelo navegador do GitHub

Envie a estrutura de arquivos-fonte da raiz, incluindo:

- `src/`, `supabase/`, `scripts/` e `docs/`;
- `AGENTS.md`, `.env.example`, `.gitignore`, `README.md` e `index.html`;
- `package.json`, `package-lock.json`, `vite.config.js` e `vercel.json`.

Não envie `node_modules/`, `dist/`, `.env`, `.vercel/`, `.supabase/`, logs,
backups ou arquivos com dados reais. O GitHub pela web pode limitar a quantidade
de arquivos por envio; faça uploads em grupos preservando exatamente as pastas.
Depois, confirme no repositório que `src/`, `supabase/`, `scripts/` e `docs/`
continuam com seus nomes e conteúdos internos.

## Estrutura

- `src/App.jsx`: composição das telas e fluxos principais
- `src/hooks/useFinance.js`: estado, persistência e regras financeiras
- `src/hooks/useSupabaseFinance.js`: persistência financeira no Supabase
- `src/utils/recurrence.js`: expansão de recorrências e parcelas
- `src/utils/exporters.js`: importação JSON e exportações JSON/CSV
- `src/components/`: formulários, painéis, gráficos e listas
- `src/styles.css`: design system responsivo e temas
- `supabase/schema.sql`: schema consolidado para uma primeira instalação
- `supabase/migrations/`: evolução incremental de instalações existentes

## Tecnologias

React 18, Vite 5, Recharts 2, Supabase e Vercel.
