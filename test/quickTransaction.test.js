// Interpretacao do lancamento rapido em texto livre.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseQuickTransaction } from '../src/utils/quickTransaction.js'

const contexto = {
  defaultDate: '2026-08-20',
  categories: [
    { id: 'moradia', name: 'Moradia', type: 'expense' },
    { id: 'freelance', name: 'Freelance', type: 'income' },
    { id: 'investimentos', name: 'Investimentos', type: 'reinvested' },
  ],
  transactions: [],
}

const parse = (texto) => parseQuickTransaction(texto, contexto)

test('centavos nao vazam para a descricao', () => {
  // Regressao do defeito descrito em quickTransaction.js:78-80: sem a
  // alternativa agrupada no regex, "1759,95" era capturado como 175 e o
  // "9,95" restante sobrava dentro da descricao.
  const r = parse('paguei aluguel 1759,95')
  assert.equal(r.amount, 1759.95)
  assert.equal(r.description, 'aluguel')
})

test('"dia N" cai no mes da data base', () => {
  assert.equal(parse('conta de luz 250 dia 5').date, '2026-08-05')
})

test('data explicita troca o mes, e o valor nao e confundido com ela', () => {
  const r = parse('aluguel 1200 10/09')
  assert.equal(r.date, '2026-09-10')
  assert.equal(r.amount, 1200)
})

test('"dia DD/MM" captura o mes e nao vaza "/MM" na descricao', () => {
  // AUDT-024 F-06: antes o "dia" casava so "dia 31" e deixava "/08" na
  // descricao; a data so batia por sorte (base tambem em agosto). O `(?![/-])`
  // faz cair na alternativa dd/mm, que captura o mes de verdade.
  const r = parse('aluguel 1200 dia 31/08')
  assert.equal(r.date, '2026-08-31')
  assert.equal(r.amount, 1200)
  assert.equal(r.description, 'aluguel')
})

test('digito extra colado a um valor completo nao vaza para a descricao', () => {
  // AUDT-024 F-06: entrada malformada. Sem o `\d*` apos os centavos, "1.2345"
  // casava "1.234" e o "5" sobrava na descricao; agora e engolido no match.
  const r = parse('luz 1.2345')
  assert.equal(r.amount, 1234)
  assert.equal(r.description, 'luz')
})

test('classifica pelo verbo e usa a categoria do tipo certo', () => {
  const receita = parse('recebi freela 800')
  assert.equal(receita.type, 'income')
  assert.equal(receita.categoryId, 'freelance')
  const aporte = parse('aporte 500')
  assert.equal(aporte.type, 'reinvested')
  assert.equal(aporte.categoryId, 'investimentos')
  assert.equal(parse('mercado 300').type, 'expense')
})

test('texto vazio nao vira lancamento', () => {
  assert.equal(parse('   '), null)
})

// Os testes acima passam `transactions: []`, entao a pontuacao por historico de
// inferCategory ficava inteiramente sem cobertura.
const comHistorico = (transactions) => ({
  defaultDate: '2026-08-20',
  categories: [
    { id: 'moradia', name: 'Moradia', type: 'expense' },
    { id: 'mercado', name: 'Mercado', type: 'expense' },
    { id: 'lazer', name: 'Lazer', type: 'expense' },
    { id: 'transporte', name: 'Transporte', type: 'expense' },
  ],
  transactions,
})

test('historico com descricao identica define a categoria', () => {
  const r = parseQuickTransaction('padaria 20', comHistorico([
    { type: 'expense', categoryId: 'mercado', description: 'padaria' },
  ]))
  assert.equal(r.categoryId, 'mercado')
  // Sem o historico nada pontua e sobra o fallback: a primeira categoria do tipo
  assert.equal(parseQuickTransaction('padaria 20', comHistorico([])).categoryId, 'moradia')
})

test('um match de substring vence muitos matches fracos', () => {
  // Regressao da correcao sugerida no achado 4.10, que trocava o maximo por uma
  // soma: somando, seis lancamentos de 4 pontos (24) venceriam o substring (20) e
  // a categoria sugerida mudaria. A pontuacao e por maximo, nao por acumulo.
  const fracos = Array.from({ length: 6 }, () => (
    { type: 'expense', categoryId: 'transporte', description: 'cinema shopping' }
  ))
  const r = parseQuickTransaction('cinema pipoca 60', comHistorico([
    ...fracos,
    { type: 'expense', categoryId: 'lazer', description: 'pipoca' },
  ]))
  assert.equal(r.categoryId, 'lazer')
})

test('nome e apelido da categoria pontuam sem historico', () => {
  assert.equal(parseQuickTransaction('mercado 300', comHistorico([])).categoryId, 'mercado')
  assert.equal(parseQuickTransaction('luz 66,30', comHistorico([])).categoryId, 'moradia')
})
