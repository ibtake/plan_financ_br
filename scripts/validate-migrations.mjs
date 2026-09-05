import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const migrationsDirectory = path.resolve('supabase', 'migrations')
const migrationName = /^(\d{14})_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/
const riskyOperations = [
  { name: 'DROP TABLE', pattern: /\bdrop\s+table\b/i },
  { name: 'DROP COLUMN', pattern: /\bdrop\s+column\b/i },
  { name: 'TRUNCATE', pattern: /\btruncate\b/i },
  { name: 'DELETE sem filtro', pattern: /\bdelete\s+from\s+[\w."-]+\s*;/i },
  { name: 'ALTER COLUMN TYPE', pattern: /\balter\s+column\b[\s\S]{0,120}\btype\b/i },
  { name: 'SET NOT NULL', pattern: /\balter\s+column\b[\s\S]{0,120}\bset\s+not\s+null\b/i },
]

// AUDT-013: os patterns de risco passam a rodar sobre o SQL sem comentario. O
// v41 cita TRUNCATE apenas em prosa e o v45 traz o rollback comentado; avisar
// sobre texto treina o revisor a ignorar o gate. Respeita string literal (com
// '' escapado), comentario de linha e bloco /* */ aninhado. Nao interpreta
// dollar-quoting de proposito: o corpo de uma funcao e codigo real e deve
// continuar sendo avaliado.
function stripComments(sql) {
  let out = ''
  let i = 0
  while (i < sql.length) {
    const current = sql[i]
    const next = sql[i + 1]
    if (current === "'") {
      let j = i + 1
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2
          continue
        }
        if (sql[j] === "'") break
        j++
      }
      out += sql.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (current === '-' && next === '-') {
      const lineEnd = sql.indexOf('\n', i)
      i = lineEnd === -1 ? sql.length : lineEnd
      continue
    }
    if (current === '/' && next === '*') {
      let depth = 1
      let j = i + 2
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') {
          depth++
          j += 2
          continue
        }
        if (sql[j] === '*' && sql[j + 1] === '/') {
          depth--
          j += 2
          continue
        }
        j++
      }
      i = j
      continue
    }
    out += current
    i++
  }
  return out
}

function fail(messages) {
  console.error('\nMigration validation failed:')
  for (const message of messages) console.error(`- ${message}`)
  process.exitCode = 1
}

const entries = await readdir(migrationsDirectory, { withFileTypes: true })
const files = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort()

// AUDT-013: as 26 migrations anteriores ao v19 nasceram sem cabecalho e nao
// podem ser reescritas (migration aplicada e imutavel). O objetivo delas vive
// no indice do README, que passa a valer como documentacao equivalente. Uma
// entrada so conta se tiver texto na coluna de objetivo, e migration nova sem
// cabeceira e sem entrada continua sendo avisada.
const indexDocument = await readFile(path.join(migrationsDirectory, 'README.md'), 'utf8').catch(() => '')
// A celula de objetivo exclui \r\n de proposito: com [^|] a linha engoliria a
// quebra e o nome da linha seguinte, reconhecendo so metade da tabela.
const indexedFiles = new Set(
  [...indexDocument.matchAll(/^\|\s*`([^`]+\.sql)`\s*\|[^|\r\n]*\S[^|\r\n]*\|/gm)].map((entry) => entry[1]),
)

const errors = []
const warnings = []
const timestamps = new Map()

for (const file of files) {
  const match = file.match(migrationName)
  if (!match) {
    errors.push(
      `${file}: use YYYYMMDDHHMMSS_descricao_em_snake_case.sql`,
    )
    continue
  }

  const timestamp = match[1]
  if (timestamps.has(timestamp)) {
    errors.push(`${file}: timestamp duplicado com ${timestamps.get(timestamp)}`)
  } else {
    timestamps.set(timestamp, file)
  }

  const sql = await readFile(path.join(migrationsDirectory, file), 'utf8')
  if (!/\S/.test(sql)) errors.push(`${file}: o arquivo esta vazio`)
  if (!/--\s*(migration|migracao)\s*:/i.test(sql) && !indexedFiles.has(file)) {
    warnings.push(`${file}: documente o objetivo no cabecalho da migracao ou no indice do README`)
  }

  const executableSql = stripComments(sql)
  for (const operation of riskyOperations) {
    if (operation.pattern.test(executableSql)) {
      warnings.push(
        `${file}: contem ${operation.name}; confirme backup, compatibilidade e recuperacao`,
      )
    }
  }
}

if (errors.length) {
  fail(errors)
} else {
  console.log(`Migration validation passed (${files.length} SQL file(s)).`)
}

if (warnings.length) {
  console.warn('\nMigration review warnings:')
  for (const warning of warnings) console.warn(`- ${warning}`)
  console.warn('Warnings require human review but do not apply or modify the database.')
}
