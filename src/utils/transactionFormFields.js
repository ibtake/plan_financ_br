export const DEFAULT_TRANSACTION_FORM_FIELDS = Object.freeze({
  method: true,
  recurrence: true,
  installments: true,
  tags: true,
  note: true,
  paid: true,
})

/** Mantem somente as preferencias suportadas e assume visibilidade por padrao. */
export function normalizeTransactionFormFields(value) {
  const fields = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return Object.fromEntries(
    Object.keys(DEFAULT_TRANSACTION_FORM_FIELDS).map((key) => [key, fields[key] !== false]),
  )
}
