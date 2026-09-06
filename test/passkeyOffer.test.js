import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  markFreshLogin,
  takeFreshLogin,
  shouldOfferPasskey,
  OFFER_PROBABILITY,
} from '../src/lib/passkeyOffer.js'

const base = { supported: true, hasLocalMark: false, freshLogin: true }

test('shouldOfferPasskey exige suporte, sem marca, login novo', () => {
  assert.equal(shouldOfferPasskey({ ...base, supported: false, random: () => 0 }), false)
  assert.equal(shouldOfferPasskey({ ...base, hasLocalMark: true, random: () => 0 }), false)
  assert.equal(shouldOfferPasskey({ ...base, freshLogin: false, random: () => 0 }), false)
})

test('shouldOfferPasskey respeita o limiar aleatorio', () => {
  assert.equal(shouldOfferPasskey({ ...base, random: () => 0 }), true)
  assert.equal(shouldOfferPasskey({ ...base, random: () => OFFER_PROBABILITY - 0.001 }), true)
  assert.equal(shouldOfferPasskey({ ...base, random: () => OFFER_PROBABILITY }), false)
  assert.equal(shouldOfferPasskey({ ...base, random: () => 0.99 }), false)
})

test('takeFreshLogin dispara uma vez e zera', () => {
  markFreshLogin()
  assert.equal(takeFreshLogin(), true)
  assert.equal(takeFreshLogin(), false)
})
