import { test } from 'node:test'
import assert from 'node:assert/strict'
import { corpoVazioDoSdk } from '../src/lib/passkeyErrors.js'

test('reconhece o parse de corpo vazio das rotas de passkey', () => {
  assert.equal(corpoVazioDoSdk({ name: 'AuthUnknownError', message: 'Unexpected end of JSON input' }), true)
  assert.equal(corpoVazioDoSdk({ name: 'AuthUnknownError', message: "Failed to execute 'json' on Response" }), true)
})

test('ignora outros erros do SDK e valores vazios', () => {
  assert.equal(corpoVazioDoSdk({ name: 'AuthApiError', message: 'insufficient_aal' }), false)
  assert.equal(corpoVazioDoSdk({ name: 'AuthUnknownError', message: 'outra coisa' }), false)
  assert.equal(corpoVazioDoSdk({ name: 'NotAllowedError', message: 'Unexpected end of JSON input' }), false)
  assert.equal(corpoVazioDoSdk(null), false)
  assert.equal(corpoVazioDoSdk(undefined), false)
  assert.equal(corpoVazioDoSdk({}), false)
})
