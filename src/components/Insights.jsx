import { useMemo } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  PartyPopper,
  PiggyBank,
  Pin,
  Search,
  ThumbsUp,
  TrendingUp,
  Trophy,
  Lightbulb,
} from 'lucide-react'
import AppIcon from './AppIcon.jsx'
import { getCategory } from '../utils/categories.js'
import { formatCurrency, formatPercent, percentChange } from '../utils/format.js'

/**
 * Gera alertas e dicas automáticas a partir dos dados do mês.
 *
 * Cada item traz `icon` (componente Lucide, para alertas do sistema) ou
 * `emoji` (ícone cadastrado pelo usuário em categorias/metas, renderizado
 * por AppIcon para respeitar imagens personalizadas).
 */
function buildInsights({ summary, previousSummary, byCategory, previousByCategory, budgets, categories, occurrences, goals }) {
  const list = []

  // 1. Saldo negativo
  if (summary.balance < 0) {
    list.push({
      tone: 'danger',
      icon: AlertTriangle,
      title: 'Você gastou mais do que ganhou',
      text: `O saldo do mês está em ${formatCurrency(summary.balance)}. Reveja as despesas maiores para equilibrar.`,
    })
  }

  // 2. Orçamentos estourados ou perto do limite
  for (const [id, limit] of Object.entries(budgets)) {
    const spent = byCategory[id] || 0
    if (!limit || spent === 0) continue
    const percent = (spent / limit) * 100
    const cat = getCategory(categories, id)
    if (percent >= 100) {
      list.push({
        tone: 'danger',
        emoji: cat.icon,
        title: `Orçamento de ${cat.name} estourado`,
        text: `Você gastou ${formatCurrency(spent)} de um limite de ${formatCurrency(limit)} (${formatPercent(percent)}).`,
      })
    } else if (percent >= 80) {
      list.push({
        tone: 'warning',
        emoji: cat.icon,
        title: `${cat.name} está em ${formatPercent(percent)} do orçamento`,
        text: `Restam apenas ${formatCurrency(limit - spent)} para o resto do mês.`,
      })
    }
  }

  // 3. Categorias com aumento relevante
  const jumps = Object.entries(byCategory)
    .map(([id, value]) => {
      const prev = previousByCategory[id] || 0
      return { id, value, prev, change: percentChange(value, prev) }
    })
    .filter((c) => c.prev > 0 && c.change >= 30 && c.value - c.prev >= 50)
    .sort((a, b) => b.change - a.change)
    .slice(0, 2)

  for (const jump of jumps) {
    const cat = getCategory(categories, jump.id)
    list.push({
      tone: 'warning',
      icon: TrendingUp,
      title: `Gasto com ${cat.name} subiu ${formatPercent(jump.change)}`,
      text: `Passou de ${formatCurrency(jump.prev)} para ${formatCurrency(jump.value)} em relação ao mês anterior.`,
    })
  }

  // 4. Contas pendentes
  const pending = occurrences.filter((t) => !t.paid && t.type === 'expense')
  if (pending.length > 0) {
    list.push({
      tone: 'warning',
      icon: Pin,
      title: `${pending.length} ${pending.length === 1 ? 'conta pendente' : 'contas pendentes'}`,
      text: `Total de ${formatCurrency(summary.pendingExpense)} ainda não pagos neste mês.`,
    })
  }

  // 5. Maior despesa do mês
  const biggest = occurrences
    .filter((t) => t.type === 'expense')
    .sort((a, b) => b.amount - a.amount)[0]
  if (biggest && summary.expense > 0 && biggest.amount / summary.expense >= 0.3) {
    list.push({
      tone: 'info',
      icon: Search,
      title: 'Uma despesa concentra boa parte do mês',
      text: `"${biggest.description}" representa ${formatPercent((biggest.amount / summary.expense) * 100)} de todos os gastos (${formatCurrency(biggest.amount)}).`,
    })
  }

  // 6. Taxa de poupança
  if (summary.income > 0) {
    if (summary.savingsRate >= 20) {
      list.push({
        tone: 'success',
        icon: PartyPopper,
        title: `Taxa de poupança de ${formatPercent(summary.savingsRate, 1)}`,
        text: `Excelente! Você guardou ${formatCurrency(summary.balance)} este mês. Continue assim.`,
      })
    } else if (summary.savingsRate > 0 && summary.savingsRate < 10) {
      list.push({
        tone: 'info',
        icon: PiggyBank,
        title: 'Sua margem de sobra está baixa',
        text: `Você guardou apenas ${formatPercent(summary.savingsRate, 1)} da renda. O ideal é começar em 10–20%.`,
      })
    }
  }

  // 7. Despesas caíram
  if (previousSummary.expense > 0 && summary.expense > 0) {
    const change = percentChange(summary.expense, previousSummary.expense)
    if (change <= -15) {
      list.push({
        tone: 'success',
        icon: ThumbsUp,
        title: `Despesas caíram ${formatPercent(Math.abs(change))}`,
        text: `Você economizou ${formatCurrency(previousSummary.expense - summary.expense)} em relação ao mês anterior.`,
      })
    }
  }

  // 8. Metas quase concluídas
  for (const goal of goals) {
    if (goal.target <= 0) continue
    const percent = (goal.current / goal.target) * 100
    if (percent >= 90 && percent < 100) {
      list.push({
        tone: 'success',
        emoji: goal.icon,
        icon: Trophy,
        title: `Meta "${goal.name}" está em ${formatPercent(percent)}`,
        text: `Faltam só ${formatCurrency(goal.target - goal.current)} para concluir!`,
      })
    }
  }

  // 9. Nenhum problema encontrado
  if (list.length === 0) {
    list.push({
      tone: 'success',
      icon: CheckCircle2,
      title: 'Tudo sob controle',
      text: 'Nenhum alerta importante neste mês. Suas finanças estão organizadas.',
    })
  }

  return list.slice(0, 6)
}

export default function Insights(props) {
  const insights = useMemo(() => buildInsights(props), [props])

  return (
    <div className="card">
      <div className="card-head">
        <div style={{ minWidth: 0 }}>
          <div className="card-title">
            <Lightbulb size={16} strokeWidth={1.9} />
            Insights do mês
          </div>
          <div className="card-sub">Alertas e observações geradas automaticamente</div>
        </div>
      </div>

      <div className="insight-list">
        {insights.map((item, i) => {
          const Icon = item.icon
          return (
            <div className={`insight ${item.tone}`} key={`${item.title}-${i}`}>
              <span className="insight-icon">
                {item.emoji ? <AppIcon emoji={item.emoji} size={16} /> : <Icon size={16} strokeWidth={2} />}
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="insight-title">{item.title}</div>
                <div className="insight-text">{item.text}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
