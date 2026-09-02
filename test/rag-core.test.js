/**
 * Testes do núcleo RAG (fase 5; design-rag-fase0.md, D9 + D10 + D3 + matriz 2.3).
 *
 * Cobre as funções PURAS de vercel+linear/api/rag-core.js: roteamento por label
 * tipo:* com precedência bug > improvement (D9), classificação determinística
 * crash × valor com os padrões exatos do design (D10), montagem da consulta
 * truncada, scrub de segredos (D3), teto de trechos, prompt com escape
 * SEM_CONTEXTO, extração/validação de citações `caminho:linha` e formatação
 * do comentário (marcador fixo, zero emoji) e, da integração D11, a lista de
 * trechos do índice para o prompt integrado do §8.i.
 *
 * O linear-webhook.js não é importado aqui (tem efeito colateral de servidor);
 * o sincronismo do MODELO_EMBED copiado em rag-core.js contra a fonte canônica
 * scripts/rag/modelo.mjs é conferido por leitura de arquivo (fronteira de deploy:
 * Root Directory = vercel+linear não empacota scripts/). Nenhum teste toca a rede.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MARCADOR_RAG,
  MODELO_EMBED,
  DIM_EMBED,
  PISO_SCORE,
  colecoesDaRota,
  rotearRag,
  classificarBug,
  montarConsulta,
  scrubTrecho,
  tetoTrechos,
  RAG_SISTEMA,
  montarPromptLLM,
  listarTrechosIndice,
  colecaoDaMemoria,
  ehCardPadronizado,
  comentarioDeFechamento8f,
  textoEntradaMemoria,
  extrairCitacoes,
  formatarComentario,
  linhaHonesto
} from '../vercel+linear/api/rag-core.js';

// ─────────────────────────────────────────────────── roteamento (D9)

test('rotearRag: tipo:bug e tipo:improvement roteiam', () => {
  assert.equal(rotearRag(['tipo:bug']).rota, 'bug');
  assert.equal(rotearRag(['tipo:improvement']).rota, 'improvement');
});

test('rotearRag: task e card sem label não roteiam (D9)', () => {
  assert.equal(rotearRag(['tipo:task']).rota, null);
  assert.equal(rotearRag([]).rota, null);
  assert.equal(rotearRag().rota, null);
  assert.equal(rotearRag(['bug']).rota, null); // sem prefixo tipo:
});

test('rotearRag: duas labels tipo:* → anomalia com precedência bug (D9)', () => {
  const r = rotearRag(['tipo:improvement', 'tipo:bug']);
  assert.equal(r.rota, 'bug');
  assert.equal(r.anomalia, true);
  const r2 = rotearRag(['tipo:bug']);
  assert.equal(r2.anomalia, false);
});

test('rotearRag: aceita nós do GraphQL e tolera espaços', () => {
  assert.equal(rotearRag([{ name: ' tipo:bug ' }, { name: 'outro' }]).rota, 'bug');
});

// ──────────────────────────────────── classificação crash × valor (D10)

test('classificarBug: padrões de crash do design (linha 126) classificam crash', () => {
  const relatos = [
    'TypeError: Cannot read properties of undefined',
    'salvarLancamento is not a function',
    'ReferenceError no carregamento',
    'SyntaxError inesperado',
    'RangeError: maximum call stack size exceeded',
    'Uncaught exception ao abrir o app',
    'unhandled promise rejection',
    'stack trace em anexo',
    'traceback no log do servidor',
    'ERR_CONNECTION_REFUSED',
    'undefined is not a function'
  ];
  for (const r of relatos) assert.equal(classificarBug(r), 'crash', r);
});

test('classificarBug: sem padrão de crash → valor (default conservador, D10)', () => {
  assert.equal(classificarBug('saldo do mês fecha errado'), 'valor');
  assert.equal(classificarBug(''), 'valor');
  assert.equal(classificarBug(null), 'valor');
});

// ───────────────────────────────────────────── consulta e trechos (D3)

test('montarConsulta: título + descrição, espaços colapsados e teto de 1500', () => {
  const c = montarConsulta('  Bug  no  saldo  ', 'descricao\n   com quebras\tmúltiplas');
  assert.equal(c, 'Bug no saldo\ndescricao com quebras múltiplas');
  const longo = montarConsulta('t', 'x'.repeat(2000));
  assert.equal(longo.length, 1500);
  assert.equal(montarConsulta('', ''), '');
  assert.equal(montarConsulta(null, undefined), '');
});

test('colecoesDaRota: bug prioriza bugs_resolvidos; improvement, decisões (D9)', () => {
  assert.deepEqual(colecoesDaRota('bug'), ['bugs_resolvidos', 'codigo']);
  assert.deepEqual(colecoesDaRota('improvement'), ['decisoes_arquitetura', 'codigo']);
  assert.deepEqual(colecoesDaRota(null), []);
});

test('scrubTrecho: remove token, conexão com credencial, Bearer e atribuições de key', () => {
  const sujo = [
    'const t = "ghp_abcdef0123456789abcdef0123456789abcd";',
    'postgres://admin:s3nh4@db.host:5432/planejador',
    'headers: { Authorization: "Bearer eykkkkkkkkkkkkkkkkkkkkkk" }',
    'api_key = "valor-supersecreto-123"'
  ].join('\n');
  const limpo = scrubTrecho(sujo);
  assert.ok(!limpo.includes('ghp_'));
  assert.ok(!limpo.includes('s3nh4'));
  assert.ok(!limpo.includes('valor-supersecreto-123'));
  assert.ok(!limpo.includes('Bearer eyk'));
  assert.ok(limpo.includes('[token removido]'));
  assert.ok(limpo.includes('[credenciais removidas]'));
  assert.ok(limpo.includes("api_key = '[valor removido]'"));
});

test('scrubTrecho: não altera texto de código normal', () => {
  const normal = 'const saldo = lancamentos.reduce((a, l) => a + l.valor, 0);';
  assert.equal(scrubTrecho(normal), normal);
});

test('tetoTrechos: teto de 8 trechos e 1500 chars, vazios descartados', () => {
  const muitos = Array.from({ length: 12 }, (_, i) => ({ rotulo: `t${i}`, texto: `texto ${i}` }));
  const cortados = tetoTrechos(muitos);
  assert.equal(cortados.length, 8);
  assert.equal(cortados[7].texto, 'texto 7');
  const longo = tetoTrechos([{ rotulo: 'x', texto: 'y'.repeat(2000) }]);
  assert.equal(longo[0].texto.length, 1500);
  assert.ok(longo[0].texto.endsWith('…'));
  assert.deepEqual(tetoTrechos([{ rotulo: 'v', texto: '   ' }, null, undefined]), []);
});

// ─────────────────────────────────────────────── prompt e citações (D8/2.3)

test('RAG_SISTEMA: escape SEM_CONTEXTO e regra de citação no system prompt', () => {
  assert.match(RAG_SISTEMA, /SEM_CONTEXTO/);
  assert.match(RAG_SISTEMA, /caminho:linha/);
  assert.match(RAG_SISTEMA, /Nunca invente caminho ou linha|nunca invente caminho ou linha/i);
});

test('montarPromptLLM: instrução muda por classificação (crash × valor × improvement)', () => {
  const base = { titulo: 'Bug no saldo', descricao: 'fecha errado', trechos: [] };
  const crash = montarPromptLLM({ ...base, rota: 'bug', classificacao: 'crash' });
  assert.match(crash, /crash \(erro\/stack\)/);
  assert.match(crash, /teste que isolaria/);
  const valor = montarPromptLLM({ ...base, rota: 'bug', classificacao: 'valor' });
  assert.match(valor, /simule o resultado/);
  const melhoria = montarPromptLLM({ ...base, rota: 'improvement', classificacao: null });
  assert.match(melhoria, /prática atual/);
});

test('montarPromptLLM: trechos numerados e teto de 8 aplicado', () => {
  const trechos = Array.from({ length: 10 }, (_, i) => ({ rotulo: `f${i}.js`, texto: `trecho ${i}` }));
  const p = montarPromptLLM({ rota: 'improvement', classificacao: null, titulo: 't', descricao: 'd', trechos });
  assert.ok(p.includes('[8]'));
  assert.ok(!p.includes('[9]'));
  assert.ok(p.includes('[1] f0.js'));
});

test('extrairCitacoes: valida contra caminhos do índice, deduplica e ignora resto', () => {
  const leitura = 'Veja `src/App.jsx:12` e `src/App.jsx:12` de novo; também `hack.js:9` e `src/lib/supabase.js:30`.';
  const cit = extrairCitacoes(leitura, ['src/App.jsx', 'src/lib/supabase.js']);
  assert.deepEqual(cit, [
    { caminho: 'src/App.jsx', linha: 12 },
    { caminho: 'src/lib/supabase.js', linha: 30 }
  ]);
  assert.deepEqual(extrairCitacoes('sem citações aqui', ['a.js']), []);
  assert.deepEqual(extrairCitacoes(null, []), []);
});

// ─────────────────────────────────────── formatação do comentário (D4/8.g)

const trechosFixos = [
  { rotulo: '`src/lib/supabase.js:12-40`', caminho: 'src/lib/supabase.js', texto: 'insert na tabela' },
  { rotulo: '`BUG-010` (memória: saldo duplicado)', texto: 'causa era re-render' }
];

test('formatarComentario: marcador primeiro, seções e zero emoji', () => {
  const corpo = formatarComentario({
    rota: 'bug',
    classificacao: 'crash',
    trechos: trechosFixos,
    leitura: 'O insert está em `src/lib/supabase.js:15`, vale confirmar a ordem.',
    citacoes: [{ caminho: 'src/lib/supabase.js', linha: 15 }]
  });
  assert.ok(corpo.startsWith(MARCADOR_RAG));
  assert.match(corpo, /### Pontos do índice/);
  assert.match(corpo, /### Leitura do código/);
  assert.match(corpo, /### Classificação/);
  assert.match(corpo, /padrão de crash/);
  assert.ok(!/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(corpo));
});

test('formatarComentario: linhas de classificação distintas por rota', () => {
  const valor = formatarComentario({
    rota: 'bug', classificacao: 'valor', trechos: trechosFixos, leitura: 'l', citacoes: []
  });
  assert.match(valor, /valor\/cálculo/);
  const melhoria = formatarComentario({
    rota: 'improvement', classificacao: null, trechos: trechosFixos, leitura: 'l', citacoes: []
  });
  assert.match(melhoria, /Melhoria: compare com as práticas/);
});

test('formatarComentario: leitura passa pelo scrub e teto de chars', () => {
  const corpo = formatarComentario({
    rota: 'bug',
    classificacao: 'crash',
    trechos: trechosFixos,
    leitura: 'token exposto: ghp_abcdef0123456789abcdef0123456789abcd no snapshot ' + 'z'.repeat(3000),
    citacoes: []
  });
  assert.ok(!corpo.includes('ghp_'));
  assert.ok(corpo.length < 4200);
});

test('linhaHonesto: mesmo marcador, 1 linha, sem LLM', () => {
  const linha = linhaHonesto('bug');
  assert.ok(linha.startsWith(MARCADOR_RAG));
  const linhas = linha.split('\n').filter((l) => l.trim());
  assert.equal(linhas.length, 2); // marcador + a linha honesta
  assert.match(linha, /sem contexto aplicável/);
});

// ─────────────────────────────── sincronismo do modelo (fronteira de deploy)

test('MODELO_EMBED/DIM_EMBED copiados em rag-core.js = fonte canônica modelo.mjs', () => {
  const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const fonte = readFileSync(resolve(raiz, 'scripts/rag/modelo.mjs'), 'utf8');
  assert.match(fonte, /export const MODELO_EMBED = 'intfloat\/multilingual-e5-small';/);
  assert.equal(MODELO_EMBED, 'intfloat/multilingual-e5-small');
  assert.equal(DIM_EMBED, 384);
});

test('PISO_SCORE calibrado na fase 5 (sondas): dentro da banda medida', () => {
  // Relevante (piso medido ~0.867 em codigo) vs lixo degenerado (teto ~0.873,
  // casos coerentes fora de domínio chegam a ~0.91): o piso 0.83 fica abaixo
  // do pior relevante com margem e corta a faixa degenerada.
  assert.ok(PISO_SCORE > 0.8 && PISO_SCORE < 0.87);
  assert.equal(PISO_SCORE, 0.83);
});

// ───────────────────────────── lista de trechos do prompt integrado (D11)

test('listarTrechosIndice: formato numerado com rótulo por trecho (D11)', () => {
  const lista = listarTrechosIndice([
    { rotulo: '`BUG-010` (memória: bug anterior)', texto: 'texto da memória' },
    { rotulo: '`src/x.js:10-20`', texto: 'const a = 1;' }
  ]);
  const blocos = lista.split('\n\n');
  assert.equal(blocos.length, 2);
  assert.match(blocos[0], /^\[1\] `BUG-010` \(memória: bug anterior\)\ntexto da memória$/);
  assert.match(blocos[1], /^\[2\] `src\/x\.js:10-20`\nconst a = 1;$/);
});

test('listarTrechosIndice: scrub de segredos e teto de 8 trechos (D11)', () => {
  const muitos = Array.from({ length: 12 }, (_, i) => ({
    rotulo: '`arquivo' + i + '.js:1-2`',
    texto: 'trecho ' + i + ' ghp_abcdef0123456789abcdef0123456789abcd'
  }));
  const lista = listarTrechosIndice(muitos);
  assert.ok(!lista.includes('ghp_')); // scrub D3 aplicado
  assert.match(lista, /^\[8\]/m); // teto D3: no máximo 8
  assert.ok(!/\[9\]/m.test(lista));
});

test('listarTrechosIndice: vazio e entradas inválidas devolvem string vazia (D11)', () => {
  assert.equal(listarTrechosIndice([]), '');
  assert.equal(listarTrechosIndice(), '');
  assert.equal(listarTrechosIndice([null, { rotulo: '', texto: '' }]), '');
});

// ─────────────────────── captura no fechamento (fase 6, D5/D7)

test('colecaoDaMemoria: prefixo → coleção/tipo, mesma tabela do backfill', () => {
  assert.deepEqual(colecaoDaMemoria('BUG-003'), { colecao: 'bugs_resolvidos', tipo: 'bug' });
  assert.deepEqual(colecaoDaMemoria('TASK-004'), { colecao: 'bugs_resolvidos', tipo: 'task' });
  assert.deepEqual(colecaoDaMemoria('IMPR-007'), { colecao: 'decisoes_arquitetura', tipo: 'improvement' });
  assert.deepEqual(colecaoDaMemoria('AUDT-019'), { colecao: 'decisoes_arquitetura', tipo: 'auditoria' });
  assert.deepEqual(colecaoDaMemoria('SUPB-001'), { colecao: 'decisoes_arquitetura', tipo: 'supabase' });
  assert.deepEqual(colecaoDaMemoria('DIN-54'), { colecao: null, tipo: null }); // sem prefixo canônico
  assert.deepEqual(colecaoDaMemoria(''), { colecao: null, tipo: null });
});

test('ehCardPadronizado: só título com prefixo [<id>] passa', () => {
  assert.ok(ehCardPadronizado('[BUG-003] Reset de senha falha no Safari'));
  assert.ok(ehCardPadronizado('  [IMPR-007] RAG')); // trim tolerante
  assert.ok(!ehCardPadronizado('Reset de senha falha no Safari')); // card humano
  assert.ok(!ehCardPadronizado(''));
  assert.ok(!ehCardPadronizado(null));
});

test('comentarioDeFechamento8f: o 8.f MAIS RECENTE com "## " vence; sem 8.f → null', () => {
  const comentarios = [
    { body: 'comentário cru do meio', createdAt: '2026-09-02T10:00:00Z' },
    { body: '## Implementação validada: primeira versão', createdAt: '2026-09-02T11:00:00Z' },
    { body: '## Implementação validada: versão final da adoção', createdAt: '2026-09-02T12:00:00Z' },
  ];
  const achado = comentarioDeFechamento8f(comentarios);
  assert.ok(achado.corpo.includes('versão final'));
  assert.equal(achado.data, '2026-09-02');
  // sem nenhum estruturado
  assert.equal(comentarioDeFechamento8f([{ body: 'só texto', createdAt: '2026-09-02T10:00:00Z' }]), null);
  assert.equal(comentarioDeFechamento8f([]), null);
  assert.equal(comentarioDeFechamento8f(null), null);
});

test('textoEntradaMemoria: título + 8.f com scrub D3 e teto de 2k chars', () => {
  const texto = textoEntradaMemoria(
    '[BUG-003] Reset de senha falha no Safari',
    '## Implementação validada\n\nCausa: token via hash. Key de teste sk-abcdef1234567890abcdef1234567890 no meio. ' + 'x'.repeat(3000)
  );
  assert.ok(texto.startsWith('[BUG-003] Reset de senha falha no Safari'));
  assert.ok(!texto.includes('sk-abcdef')); // scrub D3: segredo nunca entra no índice
  assert.ok(texto.length <= 2000); // teto D7
});

// ─────────────────────── sincronismo do modelo (fronteira de deploy)
