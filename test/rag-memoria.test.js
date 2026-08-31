/**
 * Testes do backfill de memórias (fase 4; design-rag-fase0.md, D7).
 *
 * Cobre as funções puras de scripts/rag/backfill-memorias.mjs: derivação do
 * texto de entrada a partir do comentário de fechamento (8.f/8.c), truncagem
 * no teto de 2000 chars, roteamento de coleção/tipo por prefixo (BUG-/TASK- →
 * bugs_resolvidos; IMPR-/AUDT-/SUPB- → decisoes_arquitetura) e entrada mínima
 * quando o card Done não tem comentário estruturado (D7 §Guardas).
 * O id determinístico (UUID v5 de "memoria:<card_id>") é comparado contra a
 * MESMA derivação documentada do chunk.mjs (namespace 'planejador-rag:v1') —
 * re-executar o backfill não duplica ponto.
 *
 * O script é importável sem efeito colateral (pipeline atrás de guarda de
 * execução direta): nenhum teste abaixo toca a rede.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';

import { colecaoEtipo, secoesDoComentario, textoEntrada, uuidV5 } from '../scripts/rag/backfill-memorias.mjs';

const NS = createHash('sha1').update('planejador-rag:v1').digest().subarray(0, 16);
function uuidV5Referencia(nome) {
  const h = createHash('sha1').update(NS).update(nome).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const comentario8f = `## Fechado: validação RAG completa (2026-08-31)

Contexto curto da execução.

### O que mudou
- \`scripts/rag/chunk.mjs\` e afins

### Testes executados
| Validação | Resultado |
|---|---|
| \`node --test\` | 114/114 |

### Limitações e pendências
- nada bloqueante

### Rollback
- apagar os arquivos novos`;

test('secoesDoComentario extrai as seções do 8.f', () => {
  const s = secoesDoComentario(comentario8f);
  assert.match(s.diagnostico, /Contexto curto/);
  assert.match(s.arquivos, /chunk\.mjs/);
  assert.match(s.testes, /114\/114/);
  assert.match(s.limitacoes, /nada bloqueante/);
  assert.ok(!/Rollback/.test(s.arquivos)); // seção seguinte não vaza na anterior
});

test('secoesDoComentario devolve objeto vazio para corpo sem seções conhecidas', () => {
  const s = secoesDoComentario('texto solto sem estrutura');
  assert.ok(!s.diagnostico && !s.arquivos && !s.testes && !s.limitacoes);
});

test('textoEntrada monta CARD <id> (<título>) + seções derivadas do 8.f', () => {
  const t = textoEntrada({
    card_id: 'BUG-001',
    titulo: '[BUG-001] quebra no login',
    comentario: comentario8f,
  });
  assert.ok(t.startsWith('CARD BUG-001 (quebra no login):'));
  assert.match(t, /Diagnóstico\/decisão: Contexto curto/);
  assert.match(t, /Arquivos: .*chunk\.mjs/s);
  assert.match(t, /Testes: /s);
  assert.ok(t.length <= 2000);
});

test('textoEntrada trunca no teto de 2000 chars com reticências', () => {
  // conteúdo extra DENTRO de uma seção capturada (Limitações), senão a
  // derivção simplesmente ignora e o texto nunca atinge o teto
  const grande = comentario8f.replace('- nada bloqueante', `- nada bloqueante ${'x'.repeat(3000)}`);
  const t = textoEntrada({ card_id: 'BUG-002', titulo: 't', comentario: grande });
  assert.equal(t.length, 2000);
  assert.ok(t.endsWith('…'));
});

test('textoEntrada sem comentário estruturado cai na entrada mínima (D7 §Guardas)', () => {
  const t = textoEntrada({
    card_id: 'TASK-004',
    titulo: '[TASK-004] ajuste',
    comentario: null,
    arquivos_ssot: ['src/pagina.jsx'],
  });
  assert.ok(t.startsWith('CARD TASK-004 (ajuste):'));
  assert.match(t, /Arquivos: src\/pagina\.jsx/);
});

test('colecaoEtipo roteia por prefixo (D7): BUG/TASK → bugs_resolvidos', () => {
  assert.equal(colecaoEtipo({ card_id: 'BUG-001', labels: ['tipo:bug'] }).colecao, 'bugs_resolvidos');
  assert.equal(colecaoEtipo({ card_id: 'TASK-004', labels: ['tipo:task'] }).colecao, 'bugs_resolvidos');
  assert.equal(colecaoEtipo({ card_id: 'TASK-004', labels: [] }).tipo, 'task'); // fallback pelo prefixo
});

test('colecaoEtipo roteia por prefixo (D7): IMPR/AUDT/SUPB → decisoes_arquitetura', () => {
  assert.equal(colecaoEtipo({ card_id: 'IMPR-007', labels: ['tipo:improvement'] }).colecao, 'decisoes_arquitetura');
  assert.equal(colecaoEtipo({ card_id: 'AUDT-004', labels: ['tipo:bug'] }).colecao, 'decisoes_arquitetura');
  assert.equal(colecaoEtipo({ card_id: 'AUDT-004', labels: ['tipo:bug'] }).tipo, 'bug'); // label vence o prefixo
  assert.equal(colecaoEtipo({ card_id: 'SUPB-001', labels: [] }).colecao, 'decisoes_arquitetura');
  assert.equal(colecaoEtipo({ card_id: 'XXX-001', labels: [] }).colecao, null); // prefixo estranho não roteia
});

test('uuidV5 do backfill é idêntico à derivação do chunk.mjs (namespace planejador-rag:v1)', () => {
  assert.equal(uuidV5('memoria:DIN-33'), uuidV5Referencia('memoria:DIN-33'));
  assert.equal(uuidV5('memoria:DIN-33'), uuidV5('memoria:DIN-33')); // determinístico
  assert.notEqual(uuidV5('memoria:DIN-33'), uuidV5('memoria:DIN-34')); // id distinto por card
});
