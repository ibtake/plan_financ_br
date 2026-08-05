# Planejador Financeiro

Aplicação web para organizar receitas, despesas, orçamentos e metas financeiras mês a mês. Os dados ficam no `localStorage` do navegador e podem ser exportados para backup.

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

## Executar localmente

Requer Node.js 18 ou superior.

```bash
npm install
npm run dev
```

Abra o endereço exibido pelo Vite, normalmente `http://localhost:5173`.

Para gerar a versão de produção:

```bash
npm run build
npm run preview
```

## Armazenamento e privacidade

Não há servidor nem envio de informações para serviços externos. Lançamentos, categorias, orçamentos, metas e tema ficam armazenados apenas no navegador atual. Limpar os dados do navegador também remove os dados do planejador, portanto use **Configurações > Baixar backup JSON** periodicamente.

## Estrutura

- `src/App.jsx`: composição das telas e fluxos principais
- `src/hooks/useFinance.js`: estado, persistência e regras financeiras
- `src/utils/recurrence.js`: expansão de recorrências e parcelas
- `src/utils/exporters.js`: importação JSON e exportações JSON/CSV
- `src/components/`: formulários, painéis, gráficos e listas
- `src/styles.css`: design system responsivo e temas

## Tecnologias

React 18, Vite 5 e Recharts 2.