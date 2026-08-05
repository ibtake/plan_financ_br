// Exportacao de backup (JSON) e planilha (CSV)

import { formatDate } from './format.js'
import { getCategory, getPaymentMethod } from './categories.js'
import { recurrenceLabel } from './recurrence.js'

function download(filename, content, mime) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function stamp() {
  return new Date().toISOString().slice(0, 10)
}

export function exportJSON(data) {
  const payload = {
    app: 'planejador-financeiro',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  }
  download(`planejador-backup-${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json')
}

function csvCell(value) {
  const s = String(value ?? '')
  return `"${s.replace(/"/g, '""')}"`
}

export function exportCSV(rows, categories, filename = `planejador-${stamp()}.csv`) {
  const header = [
    'Data',
    'Tipo',
    'Descrição',
    'Categoria',
    'Valor',
    'Pagamento',
    'Status',
    'Recorrência',
    'Tags',
    'Observação',
  ]

  const lines = rows.map((tx) => {
    const cat = getCategory(categories, tx.categoryId)
    return [
      formatDate(tx.date),
      tx.type === 'income' ? 'Receita' : 'Despesa',
      tx.description,
      cat.name,
      String(Number(tx.amount).toFixed(2)).replace('.', ','),
      getPaymentMethod(tx.method).name,
      tx.paid ? 'Pago' : 'Pendente',
      recurrenceLabel(tx) || '—',
      (tx.tags || []).join(' '),
      tx.note || '',
    ]
      .map(csvCell)
      .join(';')
  })

  // BOM para o Excel reconhecer os acentos
  download(filename, `\uFEFF${[header.map(csvCell).join(';'), ...lines].join('\n')}`, 'text/csv')
}

/**
 * Le um arquivo de backup e devolve o objeto `data`.
 *
 * SEGURANCA
 *   O arquivo vem do disco do usuario e nao e confiavel. Antes de chegar
 *   ao banco ele passa por tres barreiras:
 *     1. Limite de tamanho, para nao travar a aba com um JSON gigante
 *     2. Checagem de formato e de limite de itens por colecao
 *     3. Normalizacao por registro no hook, e as constraints do Postgres
 *   A ultima palavra e sempre do banco: as constraints em schema.sql
 *   rejeitam valor fora de faixa mesmo que algo escape daqui.
 */

/** Backup legitimo raramente passa de poucos MB */
const MAX_FILE_BYTES = 8 * 1024 * 1024

/** Teto por colecao, alinhado ao uso real da aplicacao */
const MAX_ITEMS = { transactions: 20000, categories: 500, goals: 500, budgets: 500 }

export function importJSON(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error('Arquivo muito grande para ser um backup do Planejador (limite de 8 MB).'))
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        const data = parsed?.data ?? parsed

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          reject(new Error('Arquivo inválido: não parece um backup do Planejador.'))
          return
        }
        if (!Array.isArray(data.transactions)) {
          reject(new Error('Arquivo inválido: não parece um backup do Planejador.'))
          return
        }

        // Colecoes opcionais precisam ter o tipo certo quando presentes
        if (data.categories !== undefined && !Array.isArray(data.categories)) {
          reject(new Error('Arquivo inválido: a lista de categorias está corrompida.'))
          return
        }
        if (data.goals !== undefined && !Array.isArray(data.goals)) {
          reject(new Error('Arquivo inválido: a lista de metas está corrompida.'))
          return
        }
        if (
          data.budgets !== undefined &&
          (typeof data.budgets !== 'object' || data.budgets === null || Array.isArray(data.budgets))
        ) {
          reject(new Error('Arquivo inválido: a lista de orçamentos está corrompida.'))
          return
        }

        const oversized = [
          ['transactions', data.transactions?.length || 0],
          ['categories', data.categories?.length || 0],
          ['goals', data.goals?.length || 0],
          ['budgets', Object.keys(data.budgets || {}).length],
        ].find(([key, count]) => count > MAX_ITEMS[key])

        if (oversized) {
          reject(new Error(`Arquivo inválido: quantidade de registros acima do limite permitido.`))
          return
        }

        resolve(data)
      } catch {
        reject(new Error('Não foi possível ler o arquivo JSON.'))
      }
    }
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo.'))
    reader.readAsText(file)
  })
}
