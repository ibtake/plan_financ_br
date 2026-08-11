import {
  LayoutDashboard,
  Receipt,
  Target,
  Trophy,
  Tags,
  Palette,
  ShieldCheck,
  Settings,
  PiggyBank,
} from 'lucide-react'

/**
 * Fonte unica de verdade da navegacao.
 *
 * Os `id` sao os mesmos usados por App.jsx para decidir qual painel
 * renderizar — mudar um id aqui quebraria a troca de abas.
 *
 * `primary` marca os itens que aparecem direto na barra inferior do
 * mobile; os demais ficam no menu "Mais".
 */
export const NAV_ITEMS = [
  { id: 'overview', label: 'Visão geral', short: 'Início', icon: LayoutDashboard, primary: true, group: 'main' },
  { id: 'transactions', label: 'Lançamentos', short: 'Lanç.', icon: Receipt, primary: true, group: 'main' },
  { id: 'goals', label: 'Metas', short: 'Metas', icon: Trophy, primary: true, group: 'main' },
  { id: 'pgbl', label: 'Aporte Certo', short: 'Aporte', icon: PiggyBank, primary: true, group: 'main' },
  { id: 'budget', label: 'Orçamento', short: 'Orçam.', icon: Target, group: 'main' },
  { id: 'categories', label: 'Categorias', short: 'Categ.', icon: Tags, group: 'manage' },
  { id: 'icons', label: 'Ícones', short: 'Ícones', icon: Palette, group: 'manage' },
  { id: 'security', label: 'Segurança', short: 'Segur.', icon: ShieldCheck, group: 'manage' },
  { id: 'settings', label: 'Configurações', short: 'Config.', icon: Settings, group: 'manage' },
]

export const NAV_GROUPS = [
  { id: 'main', label: 'Painel' },
  { id: 'manage', label: 'Gerenciar' },
]

export const NAV_BY_ID = new Map(NAV_ITEMS.map((item) => [item.id, item]))

/** Itens fixos da barra inferior do mobile (o 5º slot e o menu "Mais") */
export const MOBILE_PRIMARY = NAV_ITEMS.filter((item) => item.primary)

/** Itens que ficam no menu "Mais" do mobile */
export const MOBILE_SECONDARY = NAV_ITEMS.filter((item) => !item.primary)
