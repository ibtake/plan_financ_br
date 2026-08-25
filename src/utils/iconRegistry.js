// Catalogo de todos os emojis usados na interface.
//
// COMO FUNCIONA
//   O registro e indexado pelo proprio caractere do emoji. Isso permite que
//   qualquer ponto da interface troque um emoji por PNG sem precisar conhecer
//   um "id" novo: o componente AppIcon recebe o emoji e procura o override.
//   Vale tambem para os icones de categoria, que ficam gravados no banco.
//
// GRUPOS
//   Servem apenas para organizar a tela de personalizacao, permitindo validar
//   um conjunto de telas por vez.

export const ICON_GROUPS = [
  { id: 'expense', name: 'Categorias de despesa', hint: 'Aparecem nos lançamentos, gráficos e orçamento' },
  { id: 'income', name: 'Categorias de receita', hint: 'Aparecem nos lançamentos e no resumo do mês' },
  { id: 'payment', name: 'Formas de pagamento', hint: 'Lista de lançamentos e formulário' },
  { id: 'nav', name: 'Navegação', hint: 'Abas principais e cabeçalho' },
  { id: 'action', name: 'Ações', hint: 'Botões de criar, editar, excluir, importar e exportar' },
  { id: 'status', name: 'Status e alertas', hint: 'Pago, pendente, avisos e erros' },
  { id: 'insight', name: 'Análises e destaques', hint: 'Cartão de insights e maiores despesas' },
  { id: 'security', name: 'Eventos de segurança', hint: 'Histórico da aba Segurança' },
  { id: 'brand', name: 'Tema e aparência', hint: 'Alternância de tema e aparência da interface' },
]

/**
 * Cada entrada: [emoji, rotulo, grupo, onde aparece]
 * A ordem dentro do grupo e a ordem exibida na tela.
 */
const RAW = [
  // Categorias de despesa
  ['🏠', 'Moradia', 'expense', 'Categoria padrão'],
  ['🍽️', 'Alimentação', 'expense', 'Categoria padrão'],
  ['🛒', 'Mercado', 'expense', 'Categoria padrão'],
  ['🚗', 'Transporte', 'expense', 'Categoria padrão'],
  ['💊', 'Saúde', 'expense', 'Categoria padrão'],
  ['📚', 'Educação', 'expense', 'Categoria padrão'],
  ['🎬', 'Lazer', 'expense', 'Categoria padrão'],
  ['📺', 'Assinaturas', 'expense', 'Categoria padrão'],
  ['🛍️', 'Compras', 'expense', 'Categoria padrão'],
  ['🐾', 'Pets', 'expense', 'Categoria padrão'],
  ['💳', 'Dívidas / Cartão de débito', 'expense', 'Categoria e forma de pagamento'],
  ['🧾', 'Impostos / Boleto', 'expense', 'Categoria, pagamento e lista vazia'],
  ['📦', 'Outros (despesa)', 'expense', 'Categoria padrão e backup'],

  // Categorias de receita
  ['💼', 'Salário', 'income', 'Categoria padrão'],
  ['💻', 'Freelance', 'income', 'Categoria padrão e meta'],
  ['📈', 'Investimentos', 'income', 'Categoria, insight e gráfico'],
  ['🏘️', 'Aluguel recebido', 'income', 'Categoria padrão'],
  ['🎁', 'Presente', 'income', 'Categoria padrão e meta'],
  ['↩️', 'Reembolso', 'income', 'Categoria padrão'],

  // Formas de pagamento
  ['⚡', 'Pix', 'payment', 'Forma de pagamento'],
  ['🏦', 'Cartão de crédito', 'payment', 'Forma de pagamento'],
  ['💵', 'Dinheiro', 'payment', 'Forma de pagamento'],
  ['🔁', 'Transferência / Recorrência', 'payment', 'Pagamento, recorrência e auditoria'],
  ['❔', 'Não identificado', 'payment', 'Categoria ou pagamento desconhecido'],

  // Navegação
  ['📊', 'Visão geral', 'nav', 'Aba e gráfico de receitas × despesas'],
  ['📝', 'Lançamentos', 'nav', 'Aba e lista vazia'],
  ['🎯', 'Metas / Orçamento', 'nav', 'Abas, orçamento e metas'],
  ['🏷️', 'Categorias', 'nav', 'Aba de categorias'],
  ['🔐', 'Segurança', 'nav', 'Aba, login e MFA'],
  ['⚙️', 'Configurações', 'nav', 'Aba de configurações'],
  ['🥧', 'Gráfico de pizza', 'nav', 'Despesas por categoria'],

  // Ações
  ['➕', 'Novo / Adicionar', 'action', 'Botões de criação em várias telas'],
  ['✏️', 'Editar', 'action', 'Orçamento, categorias, metas e formulário'],
  ['🗑️', 'Excluir', 'action', 'Orçamento, categorias, metas e lançamentos'],
  ['📥', 'Importar / Receita', 'action', 'Backup, resumo e formulário'],
  ['📤', 'Exportar / Despesa', 'action', 'Backup, resumo e formulário'],
  ['⬇️', 'Baixar', 'action', 'Exportar backup e CSV'],
  ['⬆️', 'Enviar arquivo', 'action', 'Importar backup'],
  ['💾', 'Salvar backup', 'action', 'Configurações'],
  ['🧪', 'Dados de exemplo', 'action', 'Configurações'],
  ['🔍', 'Buscar', 'action', 'Filtro de lançamentos e insights'],
  ['🗒️', 'Observação', 'action', 'Detalhe do lançamento'],
  ['📁', 'Categoria nova', 'action', 'Ícone padrão ao criar categoria'],

  // Status e alertas
  ['✅', 'Pago / Concluído', 'status', 'Lista, insights e auditoria'],
  ['⭕', 'Pendente', 'status', 'Lista de lançamentos'],
  ['⚠️', 'Atenção', 'status', 'Orçamento, contas fixas e resumo'],
  ['🚨', 'Alerta crítico', 'status', 'Insights e auditoria'],
  ['🛑', 'Bloqueio', 'status', 'Auditoria de segurança'],
  ['⛔', 'Acesso negado', 'status', 'Auditoria de segurança'],
  ['✔', 'Requisito atendido', 'status', 'Validação de senha'],
  ['⏰', 'Prazo', 'status', 'Metas'],

  // Analises e destaques
  ['💡', 'Dica', 'insight', 'Insights e metas'],
  ['📌', 'Destaque', 'insight', 'Insights'],
  ['🎉', 'Conquista', 'insight', 'Metas e insights'],
  ['👏', 'Parabéns', 'insight', 'Insights'],
  ['🏆', 'Meta batida', 'insight', 'Metas, insights e aba'],
  ['🐖', 'Economia', 'insight', 'Insights e resumo'],
  ['💙', 'Saldo positivo', 'insight', 'Resumo do mês'],
  // O cartao "Maiores despesas" e o ranking 1o/2o/3o lugar sairam junto com o
  // TopExpenses.jsx (B37): as 4 entradas que os servem (💸 e as medalhas) foram
  // removidas daqui porque a tela de personalizacao oferecia trocar o icone de
  // um cartao e de um ranking que nao existem em lugar nenhum da interface.

  // Eventos de seguranca
  ['👋', 'Sessão encerrada', 'security', 'Histórico de segurança'],
  ['🆕', 'Conta criada', 'security', 'Histórico de segurança'],
  ['🔓', 'MFA desativado', 'security', 'Histórico de segurança'],
  ['🔑', 'Senha alterada', 'security', 'Histórico de segurança'],
  ['📧', 'E-mail enviado', 'security', 'Histórico de segurança'],
  ['🔒', 'Conexão segura', 'security', 'Tela de login'],

  // Tema e aparência
  ['☀️', 'Tema claro', 'brand', 'Cabeçalho e configurações'],
  ['🌙', 'Tema escuro', 'brand', 'Cabeçalho e configurações'],
  ['🎨', 'Aparência', 'brand', 'Configurações'],
  ['🔧', 'Manutenção', 'brand', 'Seletor de ícone de categoria'],

  // Disponiveis no seletor de icone de categoria
  ['✈️', 'Viagem', 'expense', 'Seletor de ícone e meta'],
  ['⚽', 'Esporte', 'expense', 'Seletor de ícone'],
  ['🎵', 'Música', 'expense', 'Seletor de ícone'],
  ['👕', 'Vestuário', 'expense', 'Seletor de ícone'],
  ['☕', 'Café', 'expense', 'Seletor de ícone'],
  ['🍺', 'Bar', 'expense', 'Seletor de ícone'],
  ['🎓', 'Formação', 'income', 'Seletor de ícone de meta'],
  ['💍', 'Casamento', 'income', 'Seletor de ícone de meta'],
  ['🏖️', 'Férias', 'income', 'Seletor de ícone de meta'],
  ['📱', 'Eletrônico', 'income', 'Seletor de ícone de meta'],
  ['🐣', 'Reserva inicial', 'income', 'Seletor de ícone de meta'],
  ['🛟', 'Reserva de emergência', 'income', 'Seletor de ícone de meta'],
]

export const ICON_CATALOG = RAW.map(([emoji, label, group, usage]) => ({
  emoji,
  label,
  group,
  usage,
}))

export const TOTAL_ICONS = ICON_CATALOG.length

const CATALOG_EMOJIS = new Set(ICON_CATALOG.map((item) => item.emoji))

/**
 * Conta so os overrides cujo emoji ainda existe no catalogo (B71). Sem o filtro,
 * um override orfao - personalizacao de um emoji removido do catalogo, como as
 * 4 entradas que o B37 tirou - contava no progresso mas some do grid (que itera
 * o catalogo), estourando 100% e o rotulo "X de TOTAL_ICONS". Os orfaos NAO sao
 * apagados: continuam no localStorage e visiveis para o "Restaurar tudo".
 */
export function countCatalogOverrides(overrides) {
  if (!overrides) return 0
  let n = 0
  for (const emoji of Object.keys(overrides)) {
    if (CATALOG_EMOJIS.has(emoji)) n++
  }
  return n
}
