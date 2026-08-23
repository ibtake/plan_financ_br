// Exportacao de backup (JSON) e planilha (CSV)

import { formatDate } from './format.js'
import { TYPE_META, getCategory, getPaymentMethod } from './categories.js'
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
  // Revoke adiado de proposito. A spec atual resolve a blob URL na analise do
  // `href`, dentro do proprio `click()`, entao revogar aqui nao cancelaria o
  // download - mas navegadores antigos abortavam a transferencia, e adiar custa
  // 1 s de blob retido. Nao remova por parecer inutil: `test/exportJSON.test.js`
  // falha se o revoke voltar a ser sincrono, e tambem se ele deixar de acontecer.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function stamp() {
  return new Date().toISOString().slice(0, 10)
}

export function exportJSON(data) {
  const payload = {
    app: 'dindin-10',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  }
  download(`dindin-10-backup-${stamp()}.json`, JSON.stringify(payload, null, 2), 'application/json')
}

function csvCell(value) {
  let s = String(value ?? '')
  // V-02: neutraliza CSV/formula injection. O Excel tambem executa formulas
  // precedidas de espacos/quebras, entao a checagem e feita sobre o valor
  // APOS remover espacos e controles iniciais (espaco, TAB, CR, LF, NBSP).
  // CR/LF embutidos viram espaco para impedir contrabando de linhas/celulas.
  s = s.replace(/^\s+/, '').replace(/[\r\n]+/g, ' ')
  // Pentest 16/08: aspas/apostrofo iniciais entram por defesa em profundidade
  // (parsers podem trata-los de forma distinta).
  if (/^[=+\-@'"]/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

export function exportCSV(rows, categories, filename = `dindin-10-${stamp()}.csv`) {
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
      TYPE_META[tx.type]?.label || 'Despesa',
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
 *     3. Sanitizacao recursiva contra Prototype Pollution
 *     4. Normalizacao por registro no hook, e as constraints do Postgres
 *   A ultima palavra e sempre do banco: as constraints em schema.sql
 *   rejeitam valor fora de faixa mesmo que algo escape daqui.
 */

/** Backup legitimo raramente passa de poucos MB */
const MAX_FILE_BYTES = 8 * 1024 * 1024

/** Teto por colecao, alinhado ao uso real da aplicacao */
const MAX_ITEMS = {
  transactions: 20000, categories: 500, goals: 500, budgets: 500,
  standardGoalContributions: 20000, reverseGoalContributions: 20000,
  reverseGoalHistory: 20000, reverseGoalEvents: 20000, pgblPlans: 100,
}
const MAX_NESTING_DEPTH = 50

/**
 * Colecoes de metas/PGBL que ficaram de fora da barreira original (achado 3.12).
 *
 * Nao entram num laco unico sobre MAX_ITEMS porque `budgets` nao e lista, e um
 * mapa {categoryId: valor} - vale o bloco proprio e a contagem por Object.keys.
 *
 * Tipo errado nas quatro primeiras hoje nao chega ao banco: `importData` cai no
 * fallback e mantem o estado atual. O caso grave e `pgblPlans`, que chega por
 * argumento (App.jsx) atraves de um `??` que so filtra null/undefined: ali o
 * fallback e `[]` e a RPC faz replace total, entao um arquivo corrompido apagava
 * em silencio todos os planos do Aporte Certo e a tela dizia "importado com
 * sucesso". Recusar o arquivo aqui e o unico ponto que evita isso.
 */
const GOAL_COLLECTIONS = [
  'standardGoalContributions', 'reverseGoalContributions',
  'reverseGoalHistory', 'reverseGoalEvents', 'pgblPlans',
]

/**
 * CORRECAO 5: Sanitizacao recursiva contra Prototype Pollution
 *
 * Remove chaves perigosas que podem poluir o prototype de Object:
 * - __proto__
 * - constructor
 * - prototype
 *
 * Estas chaves sao vetores de ataque conhecidos. Um JSON forjado pode
 * usar essas propriedades para injetar codigo ou alterar comportamento
 * de objetos globais. A sanitizacao acontece ANTES de qualquer uso
 * dos dados, impedindo que cheguem ao estado da aplicacao ou ao banco.
 */
function sanitizeObject(obj, depth = 0) {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }
  if (depth > MAX_NESTING_DEPTH) throw new Error('Backup aninhado demais.')

  // Arrays: sanitiza cada elemento recursivamente
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, depth + 1))
  }

  // Objetos: cria um novo objeto limpo removendo chaves perigosas
  const sanitized = {}
  for (const key of Object.keys(obj)) {
    // Bloqueia as tres chaves de ataque conhecidas
    const lowerKey = key.toLowerCase()
    if (lowerKey === '__proto__' || lowerKey === 'constructor' || lowerKey === 'prototype') {
      // Silenciosamente descarta a chave - nao ha uso legitimo para elas em backup
      continue
    }

    // Recursivamente sanitiza valores aninhados
    sanitized[key] = sanitizeObject(obj[key], depth + 1)
  }

  return sanitized
}

export function importJSON(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_BYTES) {
      reject(new Error('Arquivo muito grande para ser um backup do DinDin 10! (limite de 8 MB).'))
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))

        // CORRECAO 5: Sanitiza ANTES de qualquer uso
        const sanitized = sanitizeObject(parsed)
        const data = sanitized?.data ?? sanitized

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          reject(new Error('Arquivo inválido: não parece um backup do DinDin 10!.'))
          return
        }
        if (!Array.isArray(data.transactions)) {
          reject(new Error('Arquivo inválido: não parece um backup do DinDin 10!.'))
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

        // Chave ausente segue ausente de proposito: enviar `[]` no lugar apagaria
        // o historico de um backup antigo, e a RPC tem fallback proprio (achado 1.2).
        for (const key of GOAL_COLLECTIONS) {
          if (data[key] === undefined) continue
          if (!Array.isArray(data[key])) {
            const rotulo = key === 'pgblPlans' ? 'os planos do Aporte Certo' : 'os dados de metas'
            reject(new Error(`Arquivo inválido: ${rotulo} estão corrompidos.`))
            return
          }
          if (data[key].length > MAX_ITEMS[key]) {
            reject(new Error(`Arquivo inválido: quantidade de registros acima do limite permitido.`))
            return
          }
        }

        // A RPC faz (p_data->>'reverseGoalRetentionMonths')::smallint numa coluna
        // com check between 1 and 12 (schema.sql:1656). Um texto ou um numero fora
        // da faixa nao corrompe nada, mas derruba o restore inteiro em rollback com
        // erro cru de Postgres - a recusa limpa e aqui.
        const retention = data.reverseGoalRetentionMonths
        if (retention !== undefined && retention !== null && !(Number.isInteger(retention) && retention >= 1 && retention <= 12)) {
          reject(new Error('Arquivo inválido: o período de retenção de metas concluídas está fora da faixa de 1 a 12 meses.'))
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
