import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFactors, needsMfaBeforePasswordChange } from '../src/lib/mfaFactors.js'

// AUDT-026: erro de leitura da API de MFA nao pode virar "conta sem MFA".
test('erro da API sai como { error }, nunca como lista vazia', () => {
  const out = normalizeFactors({ data: null, error: { message: 'network' } })
  assert.deepEqual(out, { error: { message: 'network' } })
  assert.equal(out.factors, undefined)
})

test('sem fator verificado devolve lista vazia sem erro', () => {
  assert.deepEqual(normalizeFactors({ data: { totp: [] } }), { factors: [] })
  assert.deepEqual(normalizeFactors({ data: { totp: [{ id: 'a', status: 'unverified' }] } }), { factors: [] })
})

test('mantem apenas fatores verificados', () => {
  const out = normalizeFactors({
    data: { totp: [{ id: 'a', status: 'verified' }, { id: 'b', status: 'unverified' }] },
  })
  assert.equal(out.error, undefined)
  assert.equal(out.factors.length, 1)
  assert.equal(out.factors[0].id, 'a')
})

// BUG-009: aal2 exigido antes da troca de senha SOMENTE quando ha MFA e a sessao
// ainda nao subiu. E o que blinda o revoke do widget para conta MFA-sem-passkey.
test('MFA habilitado em aal1 exige confirmacao antes da troca', () => {
  assert.equal(needsMfaBeforePasswordChange({ nextLevel: 'aal2', currentLevel: 'aal1' }), true)
})

test('MFA habilitado ja em aal2 nao exige nada', () => {
  assert.equal(needsMfaBeforePasswordChange({ nextLevel: 'aal2', currentLevel: 'aal2' }), false)
})

test('sem MFA (aal1/aal1) segue sem exigir aal2 inatingivel', () => {
  assert.equal(needsMfaBeforePasswordChange({ nextLevel: 'aal1', currentLevel: 'aal1' }), false)
})

test('assurance ausente nao trava a troca', () => {
  assert.equal(needsMfaBeforePasswordChange(undefined), false)
})
