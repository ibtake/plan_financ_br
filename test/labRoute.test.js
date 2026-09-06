import test from 'node:test'
import assert from 'node:assert/strict'
import { isHomologacaoHost } from '../src/lib/labRoute.js'

test('o portao da bancada abre so no host de homologacao', () => {
  assert.equal(isHomologacaoHost('meu-app-qa.exemplo.com'), true)
  assert.equal(isHomologacaoHost('meu-app.exemplo.com'), false)
  // O ponto escapado importa: "-qa" no meio de outra palavra nao abre.
  assert.equal(isHomologacaoHost('meu-app-qacoisa.exemplo.com'), false)
  assert.equal(isHomologacaoHost(undefined), false)
})
