// Aritmetica de calendario, variacao percentual e leitura de valor digitado.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addMonths, currentMonthKey, isoDateInMonth, lastMonths, monthsBehind, parseAmount, percentChange, uid } from '../src/utils/format.js'

test('isoDateInMonth prende o dia dentro do mes', () => {
  // Este clamp e a origem do achado 1.7: a Edge Function do widget comparava
  // data exata sem ele e o vencimento do dia 31 desaparecia em fevereiro.
  assert.equal(isoDateInMonth('2026-02', 31), '2026-02-28')
  assert.equal(isoDateInMonth('2024-02', 31), '2024-02-29')
  assert.equal(isoDateInMonth('2026-02', 0), '2026-02-01')
  assert.equal(isoDateInMonth('2026-08', 5), '2026-08-05')
})

test('lastMonths ancorado em dezembro devolve o ano civil', () => {
  // E o que o card de patrimonio do ano usa (B12): nenhum helper novo foi
  // criado porque dezembro + 12 ja da janeiro..dezembro em ordem crescente.
  const ano = lastMonths('2026-12', 12)
  assert.equal(ano.length, 12)
  assert.equal(ano[0], '2026-01')
  assert.equal(ano.at(-1), '2026-12')
  assert.deepEqual(lastMonths('2026-01', 3), ['2025-11', '2025-12', '2026-01'])
})

test('monthsBehind mede o atraso da correcao da meta reversa (B30)', () => {
  // Ancorado no mes corrente, nao em datas fixas: o aviso do card compara com
  // >= 2 porque a serie 4390 do BCB publica o mes fechado com dias de atraso -
  // 1 mes de folga e normal, 2 e Selic parada.
  const agora = currentMonthKey()
  assert.equal(monthsBehind(agora), 0)
  assert.equal(monthsBehind(addMonths(agora, -1)), 1)
  assert.equal(monthsBehind(addMonths(agora, -2)), 2)
  assert.equal(monthsBehind(addMonths(agora, -14)), 14)
  // reference_month vem do Postgres como data ISO completa.
  assert.equal(monthsBehind(`${addMonths(agora, -3)}-01`), 3)
  // Mes futuro e chave invalida nao podem acusar atraso: sem historico o card
  // usa reverseStartDate, que numa meta criada hoje e o proprio mes corrente.
  assert.equal(monthsBehind(addMonths(agora, 1)), 0)
  assert.equal(monthsBehind(''), 0)
  assert.equal(monthsBehind('abc'), 0)
})

test('percentChange devolve null quando a base e zero', () => {
  // null e o que faz o indicador mostrar "novo" em vez de um percentual falso.
  assert.equal(percentChange(10, 0), null)
  assert.equal(percentChange(0, 0), 0)
  assert.equal(percentChange(150, 100), 50)
  // Base negativa usa o modulo: sair de -100 para 50 e melhora de 150%.
  assert.equal(percentChange(50, -100), 150)
})

test('parseAmount aceita os dois formatos digitados', () => {
  assert.equal(parseAmount('1.234,56'), 1234.56)
  assert.equal(parseAmount('1234.56'), 1234.56)
  assert.equal(parseAmount('R$ 1.759,95'), 1759.95)
  assert.equal(parseAmount(12.5), 12.5)
  assert.equal(parseAmount(''), 0)
  assert.equal(parseAmount('abc'), 0)
})

// B44: sem virgula, o ponto e milhar quando os grupos tem 3 digitos exatos.
// Nenhuma tela alcanca este caminho - os 11 pontos de chamada passam por
// formatAmountInput, que so emite virgula, e quickTransaction.js:109 tira os
// pontos antes -, entao o que se cobre aqui e o contrato da funcao para o
// proximo consumidor.
test('parseAmount le ponto como milhar quando os grupos sao de 3 digitos', () => {
  assert.equal(parseAmount('1.234'), 1234)
  assert.equal(parseAmount('1.234.567'), 1234567)
  assert.equal(parseAmount('R$ 12.500'), 12500)
  // Do outro lado da fronteira: quem nao casa o padrao segue decimal.
  assert.equal(parseAmount('1234.56'), 1234.56)
  assert.equal(parseAmount('12.5'), 12.5)
  assert.equal(parseAmount('0.5'), 0.5)
  assert.equal(parseAmount('1.23'), 1.23)
  // AUDT-024 F-01: grupo inicial com zero e decimal, nao milhar - antes "0.123"
  // virava 123 e "0.500" virava 500 porque \d{1,3} casava o "0".
  assert.equal(parseAmount('0.123'), 0.123)
  assert.equal(parseAmount('0.500'), 0.5)
})

// uid() era timestamp em ms + 6 chars base36 (31 bits nao criptograficos):
// colidia com duas chamadas no mesmo milissegundo, que e exatamente o que
// buildSampleData faz em rajada (sampleData.js:20, :121, :130, :139). O que se
// prende aqui e o contrato pos-B51 - CSPRNG e formato UUID -, porque nada em
// test/ tocava nesta funcao antes.
test('uid devolve UUID v4 e nao repete em rajada', () => {
  assert.match(uid(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

  // 5.000 no mesmo tick: a versao antiga passava aqui por sorte, nao por
  // garantia - 31 bits dao ~0,3% de chance de par repetido neste volume.
  const ids = new Set()
  for (let i = 0; i < 5000; i++) ids.add(uid())
  assert.equal(ids.size, 5000)
})
