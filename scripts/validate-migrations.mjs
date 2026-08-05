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
  if (!/--\s*(migration|migracao)\s*:/i.test(sql)) {
    warnings.push(`${file}: documente o objetivo no cabecalho da migracao`)
  }

  for (const operation of riskyOperations) {
    if (operation.pattern.test(sql)) {
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
