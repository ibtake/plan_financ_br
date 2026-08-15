import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const migrationsDirectory = path.resolve('supabase', 'migrations')
const schemaPath = path.resolve('supabase', 'schema.sql')
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const schema = await readFile(schemaPath, 'utf8')
const files = (await readdir(migrationsDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
  .map((entry) => entry.name)
  .sort()

const objects = new Map()
const add = (kind, name, file) => {
  if (!objects.has(`${kind}:${name}`)) objects.set(`${kind}:${name}`, { kind, name, file })
}
const columns = new Map()
const addColumn = (table, column, file) => {
  const name = `${table}.${column}`
  if (!columns.has(name)) columns.set(name, { table, column, file })
}
const normalizeSql = (value) => value.replace(/\s+/g, ' ').trim()
const latestFunctionBodies = new Map()

for (const file of files) {
  const sql = await readFile(path.join(migrationsDirectory, file), 'utf8')
  for (const match of sql.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\(/gi)) {
    add('function', match[1], file)
  }
  for (const match of sql.matchAll(/\bcreate\s+table(?:\s+if\s+not\s+exists)?\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    add('table', match[1], file)
  }
  for (const match of sql.matchAll(/\b(?:alter\s+table|create\s+index(?:\s+if\s+not\s+exists)?)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
    add('table', match[1], file)
  }
  for (const match of sql.matchAll(/\bcreate\s+index(?:\s+if\s+not\s+exists)?\s+([a-z_][a-z0-9_]*)/gi)) {
    add('index', match[1], file)
  }
  for (const match of sql.matchAll(/\balter\s+table\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+add\s+column(?:\s+if\s+not\s+exists)?\s+([a-z_][a-z0-9_]*)/gi)) {
    addColumn(match[1], match[2], file)
  }
  for (const match of sql.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([\s\S]*?\$\$\s*;/gi)) {
    latestFunctionBodies.set(match[1], { file, body: normalizeSql(match[0]) })
  }
}

const schemaFunctionBodies = new Map()
const schemaFunctionCounts = new Map()
for (const match of schema.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z_][a-z0-9_]*)\s*\([\s\S]*?\$\$\s*;/gi)) {
  const name = match[1]
  schemaFunctionBodies.set(name, normalizeSql(match[0]))
  schemaFunctionCounts.set(name, (schemaFunctionCounts.get(name) || 0) + 1)
}

const missing = [...objects.values()].filter(({ kind, name }) => {
  const pattern = kind === 'function'
    ? new RegExp(`\\bfunction\\s+(?:public\\.)?${escape(name)}\\s*\\(`, 'i')
    : new RegExp(`\\b${escape(name)}\\b`, 'i')
  return !pattern.test(schema)
})
const missingColumns = [...columns.values()].filter(({ table, column }) => {
  const tableBlock = new RegExp(`create\\s+table(?:\\s+if\\s+not\\s+exists)?\\s+(?:public\\.)?${escape(table)}\\s*\\(([\\s\\S]*?)\\);`, 'i').exec(schema)?.[1] || ''
  const alterColumn = new RegExp(`alter\\s+table\\s+(?:public\\.)?${escape(table)}\\s+add\\s+column(?:\\s+if\\s+not\\s+exists)?\\s+${escape(column)}\\b`, 'i')
  return !new RegExp(`\\b${escape(column)}\\b`, 'i').test(tableBlock) && !alterColumn.test(schema)
})
const replaceDefinitions = [...schema.matchAll(/\bcreate\s+or\s+replace\s+function\s+public\.replace_my_data\s*\(/gi)]
const replaceBlock = /\bcreate\s+or\s+replace\s+function\s+public\.replace_my_data\s*\([\s\S]*?grant\s+execute\s+on\s+function\s+public\.replace_my_data\s*\(jsonb\)\s+to\s+authenticated;/i.exec(schema)?.[0] || ''
const replaceSemanticErrors = []
if (replaceDefinitions.length !== 1) replaceSemanticErrors.push(`replace_my_data deve ter uma unica definicao ativa (encontradas: ${replaceDefinitions.length})`)
for (const required of ['standardGoalContributions', 'standard_goal_contributions', 'reverseGoalHistory', 'pgbl_plans']) {
  if (!replaceBlock.includes(required)) replaceSemanticErrors.push(`replace_my_data perdeu o suporte a ${required}`)
}
const functionMismatches = [...latestFunctionBodies.entries()]
  .filter(([name, { body }]) => schemaFunctionBodies.get(name) !== body)
  .map(([name, { file }]) => `${name} diverge da ultima migration (${file})`)
const duplicateFunctions = [...schemaFunctionCounts.entries()]
  .filter(([, count]) => count > 1)
  .map(([name, count]) => `${name} possui ${count} definicoes no schema.sql`)

if (missing.length || missingColumns.length || replaceSemanticErrors.length || functionMismatches.length || duplicateFunctions.length) {
  console.error('Schema synchronization failed:')
  for (const item of missing) console.error(`- ${item.file}: ${item.kind} public.${item.name} is missing from supabase/schema.sql`)
  for (const item of missingColumns) console.error(`- ${item.file}: column public.${item.table}.${item.column} is missing from supabase/schema.sql`)
  for (const error of replaceSemanticErrors) console.error(`- ${error}`)
  for (const error of functionMismatches) console.error(`- ${error}`)
  for (const error of duplicateFunctions) console.error(`- ${error}`)
  process.exit(1)
}

console.log(`Schema synchronization passed (${objects.size} migration objects and ${columns.size} migration columns checked).`)
