import { test } from 'node:test'
import assert from 'node:assert/strict'
import { markFreshLogin, takeFreshLogin, OFFER_PROBABILITY } from '../src/lib/passkeyOffer.js'

test('takeFreshLogin dispara uma vez e zera', () => {
  markFreshLogin()
  assert.equal(takeFreshLogin(), true)
  assert.equal(takeFreshLogin(), false)
})

test('OFFER_PROBABILITY e ~1/3', () => {
  assert.ok(OFFER_PROBABILITY > 0.3 && OFFER_PROBABILITY < 0.34)
})
