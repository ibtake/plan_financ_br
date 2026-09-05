import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateVerifier, deriveChallenge } from '../src/lib/pkce.js'

// Vetor canonico do RFC 7636, apendice B. Se o SHA-256 ou o base64url
// estiverem errados, o challenge nao casa com o verifier no servidor e o
// link de recuperacao nasce morto - por isso o teste guarda este par.
test('deriveChallenge reproduz o vetor do RFC 7636', async () => {
  const challenge = await deriveChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})

test('challenge nao usa caracteres fora do base64url', async () => {
  const challenge = await deriveChallenge(generateVerifier())
  assert.match(challenge, /^[A-Za-z0-9\-_]+$/)
})

test('verifier tem tamanho valido, e hex e nao repete', () => {
  const generated = new Set()
  for (let index = 0; index < 100; index += 1) {
    const verifier = generateVerifier()
    assert.equal(verifier.length, 112)
    assert.ok(verifier.length >= 43 && verifier.length <= 128)
    assert.match(verifier, /^[0-9a-f]+$/)
    generated.add(verifier)
  }
  assert.equal(generated.size, 100)
})
