// test/diag-core.test.js
// Testes do ramo DIAG do webhook Linear (§8.i): funções puras de
// vercel+linear/api/diag-core.js — sem rede, sem chave, sem Vercel.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  assinaturaValida,
  extrairCaminho,
  ehBinario,
  janelaDoTrecho,
  cadeiaLlm,
  cadeiaDiag,
  termosDeBusca,
  queryBuscaCodigo,
  consultasDeBusca,
  escolherCandidato,
  caminhosDeCodigo,
  escolherCaminhoDaLista,
  CAP_ARVORE,
  JANELA_LINHAS,
  CAP_LINHAS,
  CAP_ARQUIVO_CHARS
} from '../vercel+linear/api/diag-core.js';

const arquivoDe = (n) => Array.from({ length: n }, (_, i) => 'l' + (i + 1)).join('\n');

test('extrairCaminho: caminho com range de linhas', () => {
  assert.deepEqual(
    extrairCaminho('Erro na função: vercel+linear/api/linear-webhook.js:187-193, olhar lá'),
    { caminho: 'vercel+linear/api/linear-webhook.js', linhaIni: 187, linhaFim: 193 }
  );
});

test('extrairCaminho: linha única fecha range na mesma linha', () => {
  assert.deepEqual(
    extrairCaminho('quebra em src/components/App.tsx:42'),
    { caminho: 'src/components/App.tsx', linhaIni: 42, linhaFim: 42 }
  );
});

test('extrairCaminho: caminho sem linha cita arquivo inteiro', () => {
  assert.deepEqual(
    extrairCaminho('revisar scripts/linear-backlog.mjs quando der'),
    { caminho: 'scripts/linear-backlog.mjs', linhaIni: null, linhaFim: null }
  );
});

test('extrairCaminho: "./" inicial é removido', () => {
  assert.deepEqual(
    extrairCaminho('./src/db.js:7'),
    { caminho: 'src/db.js', linhaIni: 7, linhaFim: 7 }
  );
});

test('extrairCaminho: primeira citação válida vence', () => {
  assert.equal(extrairCaminho('docs/PADRAO-LINEAR.md e src/outro.js:5').caminho, 'docs/PADRAO-LINEAR.md');
});

test('extrairCaminho: URL da web não é confundida com arquivo do repo', () => {
  assert.equal(extrairCaminho('veja https://example.com/lib.js:10 e nada mais'), null);
});

test('extrairCaminho: pula URL e pega o caminho real depois dela', () => {
  assert.deepEqual(
    extrairCaminho('refiro https://example.com/lib.js:10 — o bug está em scripts/x.js:3'),
    { caminho: 'scripts/x.js', linhaIni: 3, linhaFim: 3 }
  );
});

test('extrairCaminho: sem citação, texto vazio ou não-string', () => {
  assert.equal(extrairCaminho('sem nenhum caminho aqui'), null);
  assert.equal(extrairCaminho(''), null);
  assert.equal(extrairCaminho(null), null);
  assert.equal(extrairCaminho(undefined), null);
});

test('ehBinario: NUL byte barra; texto passa; não-string barra', () => {
  assert.equal(ehBinario('const x = 1;'), false);
  assert.equal(ehBinario('ok\u0000não'), true);
  assert.equal(ehBinario(null), true);
  assert.equal(ehBinario(42), true);
});

test('janelaDoTrecho: sem citação → primeiras 300 linhas, teto marcado', () => {
  const j = janelaDoTrecho(arquivoDe(500), null, null);
  assert.equal(j.ini, 1);
  assert.equal(j.fim, CAP_LINHAS);
  assert.equal(j.total, 500);
  assert.equal(j.truncado, true);
  assert.ok(j.texto.startsWith('   1: l1\n'));
  assert.ok(j.texto.endsWith(' 300: l300'));
});

test('janelaDoTrecho: citação ±100 e renumeração correta', () => {
  const j = janelaDoTrecho(arquivoDe(500), 250, 250);
  assert.equal(j.ini, 250 - JANELA_LINHAS);
  assert.equal(j.fim, 250 + JANELA_LINHAS);
  assert.equal(j.truncado, false);
  const linhas = j.texto.split('\n');
  assert.equal(linhas[0], String(j.ini).padStart(4) + ': l' + j.ini);
  assert.equal(linhas.length, j.fim - j.ini + 1);
});

test('janelaDoTrecho: range citado entra inteiro na janela', () => {
  const j = janelaDoTrecho(arquivoDe(500), 187, 193);
  assert.ok(j.ini <= 187);
  assert.ok(j.fim >= 193);
});

test('janelaDoTrecho: teto absoluto de 300 linhas com range gigante', () => {
  const j = janelaDoTrecho(arquivoDe(2000), 500, 1500);
  assert.equal(j.fim - j.ini + 1, CAP_LINHAS);
  assert.ok(j.ini <= 500);
});

test('janelaDoTrecho: bordas do arquivo (citação na linha 1)', () => {
  const j = janelaDoTrecho(arquivoDe(500), 1, 1);
  assert.equal(j.ini, 1);
  assert.equal(j.fim, 1 + JANELA_LINHAS);
});

test('janelaDoTrecho: citação além do fim do arquivo clampa na última linha', () => {
  const j = janelaDoTrecho(arquivoDe(50), 900, 900);
  assert.equal(j.ini, 50);
  assert.equal(j.fim, 50);
  assert.equal(j.texto, '  50: l50');
});

test('janelaDoTrecho: arquivo pequeno sem citação não marca truncado', () => {
  const j = janelaDoTrecho(arquivoDe(50), null, null);
  assert.equal(j.ini, 1);
  assert.equal(j.fim, 50);
  assert.equal(j.truncado, false);
});

test('janelaDoTrecho: arquivo de exatamente 300 linhas sai inteiro e não é truncado (v2.27)', () => {
  const j = janelaDoTrecho(arquivoDe(300), null, null);
  assert.equal(j.fim, 300);
  assert.equal(j.truncado, false);
});

test('janelaDoTrecho: 301 linhas corta no teto e marca truncado', () => {
  const j = janelaDoTrecho(arquivoDe(301), null, null);
  assert.equal(j.fim, 300);
  assert.equal(j.truncado, true);
});

test('janelaDoTrecho: citação ±100 em arquivo maior não é truncado (janela por desenho)', () => {
  const j = janelaDoTrecho(arquivoDe(500), 250, 250);
  assert.equal(j.truncado, false);
});

test('janelaDoTrecho: não-string vira janela vazia segura', () => {
  const j = janelaDoTrecho(null, 10, 10);
  assert.equal(j.total, 1);
  assert.equal(j.texto, '   1: ');
});

test('cadeiaLlm: default sem env → gemini único, comportamento atual', () => {
  const cadeia = cadeiaLlm({});
  assert.equal(cadeia.length, 1);
  assert.equal(cadeia[0].provedor, 'gemini');
  assert.equal(cadeia[0].model, 'gemini-3.5-flash-lite');
});

test('cadeiaLlm: primário Groq via env, sem fallback se não houver key dele', () => {
  const cadeia = cadeiaLlm({ LLM_PROVIDER: 'groq', LLM_API_KEY: 'k1', LLM_MODEL: 'm1' });
  assert.equal(cadeia.length, 1);
  assert.equal(cadeia[0].provedor, 'groq');
  assert.equal(cadeia[0].key, 'k1');
  assert.equal(cadeia[0].model, 'm1');
});

test('cadeiaLlm: fallback entra só com LLM_FALLBACK_API_KEY', () => {
  const sem = cadeiaLlm({ LLM_PROVIDER: 'groq', LLM_API_KEY: 'k1', LLM_FALLBACK_MODEL: 'x' });
  assert.equal(sem.length, 1);
  const com = cadeiaLlm({
    LLM_PROVIDER: 'groq',
    LLM_API_KEY: 'k1',
    LLM_FALLBACK_PROVIDER: 'gemini',
    LLM_FALLBACK_API_KEY: 'k2',
    LLM_FALLBACK_MODEL: 'm2'
  });
  assert.equal(com.length, 2);
  assert.equal(com[1].provedor, 'gemini');
  assert.equal(com[1].key, 'k2');
  assert.equal(com[1].model, 'm2');
});

test('cadeiaDiag: Groq único, sem fallback, orçamento fixo', () => {
  const cadeia = cadeiaDiag({});
  assert.equal(cadeia.length, 1);
  assert.equal(cadeia[0].provedor, 'openai-compat');
  assert.equal(cadeia[0].base, 'https://api.groq.com/openai/v1');
  assert.equal(cadeia[0].maxTokens, 3500);
  assert.equal(cadeia[0].temperature, 0);
  assert.ok(cadeia[0].model.length > 0);
});

test('cadeiaDiag: overrides por env são respeitados', () => {
  const [cfg] = cadeiaDiag({
    DIAG_LLM_PROVIDER: 'anthropic',
    DIAG_LLM_API_KEY: 'kd',
    DIAG_LLM_MODEL: 'claude-x',
    DIAG_LLM_BASE_URL: 'https://exemplo.invalid'
  });
  assert.equal(cfg.provedor, 'anthropic');
  assert.equal(cfg.key, 'kd');
  assert.equal(cfg.model, 'claude-x');
  assert.equal(cfg.base, 'https://exemplo.invalid');
});

test('constantes de orçamento têm os valores do contrato v2.20', () => {
  assert.equal(JANELA_LINHAS, 100);
  assert.equal(CAP_LINHAS, 300);
  assert.equal(CAP_ARQUIVO_CHARS, 65536);
});

test('termosDeBusca: descarta stopwords, curtas e números; frequência primeiro, empate por ordem', () => {
  assert.deepEqual(
    termosDeBusca('Token de redefinição de senha falha no token web do iPhone, token expira'),
    ['token', 'redefinição', 'senha']
  );
});

test('termosDeBusca: entrada não-texto ou vazia devolve lista vazia', () => {
  assert.deepEqual(termosDeBusca(null), []);
  assert.deepEqual(termosDeBusca(42), []);
  assert.deepEqual(termosDeBusca('   '), []);
  assert.deepEqual(termosDeBusca('de da do para com que 123 45'), []);
});

test('queryBuscaCodigo: junta termos com qualificador repo', () => {
  assert.equal(queryBuscaCodigo(['token', 'senha'], 'user/repo'), 'token senha repo:user/repo');
});

test('queryBuscaCodigo: sem termos, sem repo ou entrada não-array devolve vazio', () => {
  assert.equal(queryBuscaCodigo([], 'user/repo'), '');
  assert.equal(queryBuscaCodigo(['token'], ''), '');
  assert.equal(queryBuscaCodigo('token', 'user/repo'), '');
  assert.equal(queryBuscaCodigo(null, 'user/repo'), '');
});

test('escolherCandidato: prefere código na ordem de relevância e ignora lockfiles', () => {
  assert.equal(
    escolherCandidato([
      { path: 'package-lock.json' },
      { path: 'src/paginas/RedefinirSenha.tsx' },
      { path: 'docs/nota.md' }
    ]),
    'src/paginas/RedefinirSenha.tsx'
  );
});

test('escolherCandidato: sem código aceita .md; sem elegível, null', () => {
  assert.equal(escolherCandidato([{ path: 'docs/nota.md' }]), 'docs/nota.md');
  assert.equal(escolherCandidato([{ path: 'imagem.png' }]), null);
  assert.equal(escolherCandidato([{ path: 'app.min.js' }]), null);
  assert.equal(escolherCandidato([]), null);
  assert.equal(escolherCandidato(null), null);
});

test('consultasDeBusca: cascata de 3 termos para 1; no máximo 2 consultas', () => {
  assert.deepEqual(
    consultasDeBusca(['senha', 'reset', 'iphone'], 'user/repo'),
    ['senha reset iphone repo:user/repo', 'senha repo:user/repo']
  );
});

test('consultasDeBusca: 2 termos também caem; 1 termo não duplica', () => {
  assert.deepEqual(
    consultasDeBusca(['senha', 'reset'], 'user/repo'),
    ['senha reset repo:user/repo', 'senha repo:user/repo']
  );
  assert.deepEqual(
    consultasDeBusca(['senha'], 'user/repo'),
    ['senha repo:user/repo']
  );
});

test('consultasDeBusca: sem termos, sem repo ou entrada não-array devolve vazio', () => {
  assert.deepEqual(consultasDeBusca([], 'user/repo'), []);
  assert.deepEqual(consultasDeBusca(['senha'], ''), []);
  assert.deepEqual(consultasDeBusca('senha', 'user/repo'), []);
  assert.deepEqual(consultasDeBusca(null, 'user/repo'), []);
});

test('caminhosDeCodigo: só blobs de código, sem ruído, alfabético e sem duplicata', () => {
  const arvore = {
    tree: [
      { path: 'src/zeta.jsx', type: 'blob' },
      { path: 'src/contexts/authOperations.js', type: 'blob' },
      { path: 'src/contexts/authOperations.js', type: 'blob' }, // duplicata
      { path: 'src/components/auth/AuthScreen.jsx', type: 'blob' },
      { path: 'src', type: 'tree' }, // diretório, fora
      { path: 'package-lock.json', type: 'blob' }, // ruído
      { path: 'docs/leiame.md', type: 'blob' }, // fora da família de código
      { path: 'dist/app.min.js', type: 'blob' }, // minificado, ruído
      { path: 'dist/assets/CategoryChart-BHaYPmDT.js', type: 'blob' }, // bundle de build, ruído
      { path: 'build/out.js', type: 'blob' } // pasta de build, ruído
    ]
  };
  assert.deepEqual(caminhosDeCodigo(arvore), [
    'src/components/auth/AuthScreen.jsx',
    'src/contexts/authOperations.js',
    'src/zeta.jsx'
  ]);
});

test('caminhosDeCodigo: aceita array cru, árvore inválida e teto CAP_ARVORE', () => {
  assert.deepEqual(
    caminhosDeCodigo([{ path: 'a.js', type: 'blob' }]),
    ['a.js']
  );
  assert.deepEqual(caminhosDeCodigo(null), []);
  assert.deepEqual(caminhosDeCodigo({}), []);
  assert.deepEqual(caminhosDeCodigo({ tree: 'não-array' }), []);
  const muitos = Array.from({ length: CAP_ARVORE + 10 }, (_, i) => ({
    path: 'm' + String(i).padStart(4, '0') + '.js',
    type: 'blob'
  }));
  const lista = caminhosDeCodigo({ tree: muitos });
  assert.equal(lista.length, CAP_ARVORE);
  assert.equal(lista[0], 'm0000.js');
  assert.equal(lista[CAP_ARVORE - 1], 'm0299.js');
});

test('escolherCaminhoDaLista: resposta limpa, com frase, caixa e ./ normalizados', () => {
  const lista = ['src/contexts/authOperations.js', 'src/components/auth/AuthScreen.jsx'];
  assert.equal(escolherCaminhoDaLista('src/contexts/authOperations.js', lista), lista[0]);
  assert.equal(escolherCaminhoDaLista('`src/contexts/authOperations.js`', lista), lista[0]);
  assert.equal(
    escolherCaminhoDaLista('O arquivo é src/contexts/authoperations.js', lista),
    lista[0]
  );
  assert.equal(escolherCaminhoDaLista('./src/contexts/authOperations.js', lista), lista[0]);
});

test('escolherCaminhoDaLista: NENHUM, caminho de fora, vazio ou lista vazia → null', () => {
  const lista = ['src/contexts/authOperations.js'];
  assert.equal(escolherCaminhoDaLista('NENHUM', lista), null);
  assert.equal(escolherCaminhoDaLista('src/outro/arquivo.js', lista), null);
  assert.equal(escolherCaminhoDaLista('', lista), null);
  assert.equal(escolherCaminhoDaLista(null, lista), null);
  assert.equal(escolherCaminhoDaLista('src/contexts/authOperations.js', []), null);
  assert.equal(escolherCaminhoDaLista('src/contexts/authOperations.js', null), null);
});

// ── assinaturaValida (v2.27, auditoria CRI-1/MED-1) ──────────────────────────

const hmacDe = (secret, corpo) =>
  crypto.createHmac('sha256', secret).update(corpo).digest('hex');

test('assinaturaValida: HMAC válido aceito; corpo alterado ou secret errado recusados', () => {
  const corpo = '{"type":"Comment","action":"create"}';
  assert.equal(assinaturaValida(corpo, hmacDe('s3cret', corpo), 's3cret'), true);
  assert.equal(assinaturaValida(corpo + ' ', hmacDe('s3cret', corpo), 's3cret'), false);
  assert.equal(assinaturaValida(corpo, hmacDe('outro', corpo), 's3cret'), false);
});

test('assinaturaValida: fail-closed — secret ausente/vazio ou assinatura ausente → false', () => {
  const corpo = '{"type":"ping"}';
  const assinatura = hmacDe('s3cret', corpo);
  const hmacVazio = hmacDe('', corpo); // o que o handler antigo computava sem env var
  assert.equal(assinaturaValida(corpo, assinatura, ''), false);
  assert.equal(assinaturaValida(corpo, assinatura, undefined), false);
  assert.equal(assinaturaValida(corpo, assinatura, null), false);
  assert.equal(assinaturaValida(corpo, hmacVazio, ''), false); // forjada de chave vazia não passa
  assert.equal(assinaturaValida(corpo, '', 's3cret'), false);
  assert.equal(assinaturaValida(corpo, undefined, 's3cret'), false);
});

test('assinaturaValida: tamanho diferente e tipos errados sem lançar', () => {
  const corpo = '{"type":"ping"}';
  const assinatura = hmacDe('s3cret', corpo);
  assert.equal(assinaturaValida(corpo, 'deadbeef', 's3cret'), false);
  assert.equal(assinaturaValida(corpo, assinatura.slice(0, 63), 's3cret'), false);
  assert.equal(assinaturaValida(corpo, null, 's3cret'), false);
  assert.equal(assinaturaValida(123, assinatura, 's3cret'), false);
  assert.equal(assinaturaValida(corpo, 42, 's3cret'), false);
});
