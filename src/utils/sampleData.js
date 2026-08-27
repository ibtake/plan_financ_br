// Dados de exemplo para o usuario testar o app rapidamente

import { currentMonthKey, addMonths, isoDateInMonth, uid } from './format.js'
import { DEFAULT_CATEGORIES } from './categories.js'

/**
 * Dados de exemplo prontos para importar.
 *
 * @param {Array} [currentCategories] categorias que o usuario tem agora. Sem
 *   elas nao ha como saber o que falta, e a chave `categories` fica fora do
 *   retorno (comportamento anterior: o exemplo nao mexe nas categorias).
 */
export function buildSampleData(currentCategories) {
  const m0 = currentMonthKey()
  const m1 = addMonths(m0, -1)
  const m2 = addMonths(m0, -2)
  const m3 = addMonths(m0, -3)

  const tx = (date, type, description, categoryId, amount, extra = {}) => ({
    id: uid(),
    date,
    type,
    description,
    categoryId,
    amount,
    method: 'pix',
    paid: true,
    recurrence: 'none',
    installments: 1,
    tags: [],
    note: '',
    paidOccurrences: {},
    createdAt: new Date().toISOString(),
    ...extra,
  })

  const transactions = [
    // Receitas recorrentes
    tx(isoDateInMonth(m3, 5), 'income', 'Salário', 'salario', 6500, { recurrence: 'monthly' }),
    tx(isoDateInMonth(m3, 20), 'income', 'Projeto freelance', 'freelance', 1800, {
      recurrence: 'quarterly',
    }),

    // Despesas fixas recorrentes
    tx(isoDateInMonth(m3, 10), 'expense', 'Aluguel', 'moradia', 1900, {
      recurrence: 'monthly',
      method: 'boleto',
    }),
    tx(isoDateInMonth(m3, 12), 'expense', 'Energia elétrica', 'moradia', 185, {
      recurrence: 'monthly',
      method: 'boleto',
    }),
    tx(isoDateInMonth(m3, 15), 'expense', 'Internet fibra', 'moradia', 119.9, {
      recurrence: 'monthly',
      method: 'debito',
    }),
    tx(isoDateInMonth(m3, 8), 'expense', 'Plano de saúde', 'saude', 420, {
      recurrence: 'monthly',
      method: 'debito',
    }),
    tx(isoDateInMonth(m3, 3), 'expense', 'Streaming (combo)', 'assinaturas', 74.9, {
      recurrence: 'monthly',
      method: 'credito',
    }),
    tx(isoDateInMonth(m3, 7), 'expense', 'Academia', 'saude', 99, {
      recurrence: 'monthly',
      method: 'credito',
    }),

    // Reinvestimento recorrente (B67). Sem nenhum lancamento deste tipo,
    // `reinvested` fica 0 em useFinance.js:19 e leva com ele o card "Patrimonio
    // do ano" (SummaryCards.jsx:106), a taxa de poupanca (:28) e a fatia de
    // reinvestidas por categoria (:90) - o exemplo nao demonstrava o REQ 3, que
    // e o mecanismo proprio do app. Mensal, para render as 4 ocorrencias dos
    // meses cobertos: ~12% dos 6500 de salario.
    tx(isoDateInMonth(m3, 6), 'reinvested', 'Aporte mensal', 'aportes', 800, {
      recurrence: 'monthly',
      method: 'transferencia',
    }),

    // Mes -2
    tx(isoDateInMonth(m2, 6), 'expense', 'Compras do mês', 'mercado', 780.4),
    tx(isoDateInMonth(m2, 14), 'expense', 'Restaurante', 'alimentacao', 156.8),
    tx(isoDateInMonth(m2, 22), 'expense', 'Combustível', 'transporte', 240),

    // Mes -1
    tx(isoDateInMonth(m1, 5), 'expense', 'Compras do mês', 'mercado', 845.2),
    tx(isoDateInMonth(m1, 11), 'expense', 'Cinema + jantar', 'lazer', 190),
    tx(isoDateInMonth(m1, 18), 'expense', 'Uber', 'transporte', 132.5),
    tx(isoDateInMonth(m1, 25), 'expense', 'Curso online', 'educacao', 297, {
      installments: 3,
      method: 'credito',
    }),
    tx(isoDateInMonth(m1, 28), 'income', 'Venda usados', 'outros-r', 350),

    // Mes atual
    tx(isoDateInMonth(m0, 4), 'expense', 'Compras do mês', 'mercado', 690.75),
    tx(isoDateInMonth(m0, 9), 'expense', 'Farmácia', 'saude', 87.3),
    tx(isoDateInMonth(m0, 13), 'expense', 'Delivery', 'alimentacao', 68.9),
    tx(isoDateInMonth(m0, 16), 'expense', 'Presente aniversário', 'compras', 150),
    tx(isoDateInMonth(m0, 21), 'expense', 'Ração e petshop', 'pets', 210, { paid: false }),
    tx(isoDateInMonth(m0, 26), 'expense', 'Fatura cartão', 'dividas', 430, {
      paid: false,
      method: 'credito',
    }),
    tx(isoDateInMonth(m0, 27), 'income', 'Dividendos', 'investimentos', 128.4),
  ]

  const budgets = {
    mercado: 800,
    alimentacao: 400,
    transporte: 350,
    lazer: 300,
    saude: 600,
    compras: 250,
    assinaturas: 120,
  }

  const goals = [
    {
      id: uid(),
      name: 'Reserva de emergência',
      target: 20000,
      current: 7400,
      deadline: `${addMonths(m0, 10)}-01`,
      icon: '🛟',
      color: '#22c55e',
    },
    {
      id: uid(),
      name: 'Viagem de férias',
      target: 8000,
      current: 2300,
      deadline: `${addMonths(m0, 6)}-01`,
      icon: '✈️',
      color: '#0ea5e9',
    },
    {
      id: uid(),
      name: 'Notebook novo',
      target: 6000,
      current: 4800,
      deadline: `${addMonths(m0, 3)}-01`,
      icon: '💻',
      color: '#8b5cf6',
    },
  ]

  // Os 23 lancamentos e os 7 orcamentos acima apontam para ids fixos de
  // categoria e nada garante que existam: nao ha FK em transactions.category_id
  // nem em budgets.category_id (schema.sql:674, :814), entao a RPC aceita o
  // insert e quem excluiu uma categoria padrao recebe dado orfao - "Sem
  // categoria" na lista, no grafico e no orcamento (achado 1.25 / B64).
  // Uniao, nao substituicao: importData troca as categorias quando o payload as
  // traz (useFinanceDataManagement.js:39) e o confirm do painel promete que as
  // personalizadas ficam. Nada faltando -> a chave sai do objeto e o exemplo
  // segue sem escrever em categories, como antes deste item.
  // O conjunto sai dos proprios dados: acrescentar lancamento aqui nao exige
  // manter lista paralela. Id fora de DEFAULT_CATEGORIES nao seria recriado -
  // ha teste de invariante em test/sampleData.test.js.
  const current = Array.isArray(currentCategories) ? currentCategories : null
  const used = new Set([...transactions.map((t) => t.categoryId), ...Object.keys(budgets)])
  const missing = current
    ? DEFAULT_CATEGORIES.filter((cat) => used.has(cat.id) && !current.some((c) => c.id === cat.id))
    : []

  if (missing.length) return { transactions, budgets, goals, categories: [...current, ...missing] }
  return { transactions, budgets, goals }
}
