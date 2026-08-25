// Categorias padrao de receitas e despesas

/**
 * Tipos aceitos de categoria/lancamento.
 *   income      -> Receita (entrada de liquidez)
 *   expense     -> Despesa (saida de liquidez, consumo)
 *   reinvested  -> Despesa Reinvestida: sai da liquidez como saida, mas NAO e
 *                  consumo — acumula patrimonio. Entra na taxa de poupanca.
 */
export const TX_TYPES = ['income', 'expense', 'reinvested']

export const TYPE_META = {
  income: { label: 'Receita', chip: 'income' },
  expense: { label: 'Despesa', chip: 'expense' },
  reinvested: { label: 'Despesa Reinvestida', chip: 'reinvested' },
}

/** Garante um tipo valido; desconhecido cai em despesa (mais conservador). */
export function normalizeType(type) {
  return TX_TYPES.includes(type) ? type : 'expense'
}

/** Categoria "Outros" padrao usada como destino ao excluir uma categoria. */
export function fallbackCategoryId(type) {
  if (type === 'income') return 'outros-r'
  if (type === 'reinvested') return 'outros-ri'
  return 'outros-d'
}

export const DEFAULT_CATEGORIES = [
  // Despesas
  { id: 'moradia', name: 'Moradia', type: 'expense', color: '#6366f1', icon: '🏠' },
  { id: 'alimentacao', name: 'Alimentação', type: 'expense', color: '#f97316', icon: '🍽️' },
  { id: 'mercado', name: 'Mercado', type: 'expense', color: '#84cc16', icon: '🛒' },
  { id: 'transporte', name: 'Transporte', type: 'expense', color: '#0ea5e9', icon: '🚗' },
  { id: 'saude', name: 'Saúde', type: 'expense', color: '#ef4444', icon: '💊' },
  { id: 'educacao', name: 'Educação', type: 'expense', color: '#8b5cf6', icon: '📚' },
  { id: 'lazer', name: 'Lazer', type: 'expense', color: '#ec4899', icon: '🎬' },
  { id: 'assinaturas', name: 'Assinaturas', type: 'expense', color: '#14b8a6', icon: '📺' },
  { id: 'compras', name: 'Compras', type: 'expense', color: '#f59e0b', icon: '🛍️' },
  { id: 'pets', name: 'Pets', type: 'expense', color: '#a3703a', icon: '🐾' },
  { id: 'dividas', name: 'Dívidas', type: 'expense', color: '#dc2626', icon: '💳' },
  { id: 'impostos', name: 'Impostos', type: 'expense', color: '#64748b', icon: '🧾' },
  { id: 'outros-d', name: 'Outros', type: 'expense', color: '#94a3b8', icon: '📦' },

  // Despesas reinvestidas (saem do caixa, viram patrimonio)
  { id: 'aportes', name: 'Aportes e investimentos', type: 'reinvested', color: '#8b5cf6', icon: '📈' },
  { id: 'outros-ri', name: 'Outros reinvestimentos', type: 'reinvested', color: '#a855f7', icon: '📦' },

  // Receitas
  { id: 'salario', name: 'Salário', type: 'income', color: '#22c55e', icon: '💼' },
  { id: 'freelance', name: 'Freelance', type: 'income', color: '#10b981', icon: '💻' },
  { id: 'investimentos', name: 'Investimentos', type: 'income', color: '#0d9488', icon: '📈' },
  { id: 'aluguel-r', name: 'Aluguel recebido', type: 'income', color: '#059669', icon: '🏘️' },
  { id: 'presente', name: 'Presente', type: 'income', color: '#a855f7', icon: '🎁' },
  { id: 'reembolso', name: 'Reembolso', type: 'income', color: '#3b82f6', icon: '↩️' },
  { id: 'outros-r', name: 'Outros', type: 'income', color: '#7dd3fc', icon: '➕' },
]

export const PAYMENT_METHODS = [
  { id: 'pix', name: 'Pix', icon: '⚡' },
  { id: 'debito', name: 'Cartão de débito', icon: '💳' },
  { id: 'credito', name: 'Cartão de crédito', icon: '🏦' },
  { id: 'dinheiro', name: 'Dinheiro', icon: '💵' },
  { id: 'boleto', name: 'Boleto', icon: '🧾' },
  { id: 'transferencia', name: 'Transferência', icon: '🔁' },
  { id: 'outro', name: 'Outro', icon: '❔' },
]

export const RECURRENCE_OPTIONS = [
  { id: 'none', name: 'Não repete' },
  { id: 'weekly', name: 'Semanal' },
  { id: 'monthly', name: 'Mensal' },
  { id: 'bimonthly', name: 'Bimestral' },
  { id: 'quarterly', name: 'Trimestral' },
  { id: 'yearly', name: 'Anual' },
]

export const CHART_PALETTE = [
  '#6366f1',
  '#f97316',
  '#22c55e',
  '#ec4899',
  '#0ea5e9',
  '#f59e0b',
  '#8b5cf6',
  '#14b8a6',
  '#ef4444',
  '#84cc16',
  '#a855f7',
  '#64748b',
]

export function getCategory(categories, id) {
  return (
    categories.find((c) => c.id === id) || {
      id: id || 'desconhecida',
      name: 'Sem categoria',
      type: 'expense',
      color: '#94a3b8',
      icon: '❔',
    }
  )
}

export function getPaymentMethod(id) {
  return PAYMENT_METHODS.find((m) => m.id === id) || { id: 'outro', name: '—', icon: '❔' }
}

export function categoriesByType(categories, type) {
  return categories.filter((c) => c.type === type)
}
