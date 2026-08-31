/**
 * Backfill one-shot das memórias do RAG (fase 4; design-rag-fase0.md, D7 §Cold start).
 *
 * Exporta os cards Done existentes no Linear (projetos Dones-N) via GraphQL
 * READ-ONLY, deriva a entrada de memória do comentário de fechamento 8.f/8.c
 * (nada é inventado), gera embeddings com o MESMO modelo da indexação
 * (scripts/rag/embed.py, D3) e faz upsert em bugs_resolvidos e
 * decisoes_arquitetura. Id de ponto determinístico = UUID v5 de
 * "memoria:<card_id>" no mesmo namespace do chunker (chunk.mjs:38-46) —
 * re-executar SUBSTITUI o ponto, nunca duplica (D7). Upsert puro: sem
 * delete-by-filter (diferente do reindex de código, que zera a coleção).
 *
 * Roteamento D7 por PREFIXO do id: BUG-/TASK- → bugs_resolvidos;
 * IMPR-/AUDT-/SUPB- → decisoes_arquitetura. `tipo` vem da label tipo:* com
 * fallback pelo prefixo. release_real/arquivos vêm do SSOT local da categoria
 * (docs/<categoria>/backlog-2026.json); SUPB não tem SSOT local → null.
 *
 * Uso:
 *   node scripts/rag/backfill-memorias.mjs --dry-run   # GraphQL read + resumo, zero escrita
 *   node scripts/rag/backfill-memorias.mjs             # dry-run + embed + upsert real
 *
 * Credenciais: LINEAR_API_KEY e QDRANT_URL/QDRANT_API_KEY via env ou registro
 * HKCU (mesmo padrão de linear-key.mjs / qdrant-key.mjs) — nunca impressas.
 * Nenhum segredo ou dado de usuário entra na entrada de memória (D3/D7).
 *
 * Ambiente Python do embed: o script semeia PYTHONPATH=.rag-libs e
 * HF_HOME=.rag-cache (dirs gitignored na raiz) ao chamar embed.py, mantendo a
 * instalação one-time e o download do modelo (~470 MB, 1ª execução) dentro do
 * workspace — o site-packages global da Store Python quebra o torch com
 * WinError 206 (caminho > 260 chars).
 *
 * Importável para teste (rag-memoria.test.js): as funções puras
 * (secoesDoComentario, textoEntrada, colecaoEtipo, uuidV5) ficam no top-level;
 * o pipeline (rede, embed, upsert) só executa quando o script é invocado
 * diretamente — importar o módulo não dispara nada.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveApiKey } from '../linear-key.mjs';
import { resolveQdrantEnv } from '../qdrant-key.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const RAIZ = resolve(import.meta.dirname, '..', '..');
const API = 'https://api.linear.app/graphql';
const TETO_TEXTO = 2000; // D7: texto estruturado de ~1-2k chars
const COLECAO_POR_PREFIXO = { BUG: 'bugs_resolvidos', TASK: 'bugs_resolvidos', IMPR: 'decisoes_arquitetura', AUDT: 'decisoes_arquitetura', SUPB: 'decisoes_arquitetura' };
const TIPO_POR_PREFIXO = { BUG: 'bug', TASK: 'task', IMPR: 'improvement', AUDT: 'auditoria', SUPB: 'supabase' };
const DONES_REGEXP = /^Dones(-\d+)?$/; // mesmo cemitério do linear-backlog.mjs

// ---------------------------------------------------------------- id determinístico
// Mesma derivação do chunk.mjs (linhas 38-46): namespace sha1 de
// 'planejador-rag:v1' + nome "memoria:<card_id>". Duplicado de propósito — o
// chunk.mjs executa o scan no top-level e não é importável.

const NAMESPACE_V5 = createHash('sha1').update('planejador-rag:v1').digest().subarray(0, 16);

export function uuidV5(nome) {
  const h = createHash('sha1').update(NAMESPACE_V5).update(nome).digest();
  h[6] = (h[6] & 0x0f) | 0x50; // versão 5
  h[8] = (h[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ------------------------------------------------------------------- key handling
// Resolvedores compartilhados (linear-key.mjs / qdrant-key.mjs): env → registro
// HKCU com redirect de arquivo (pipe de stdout dispara EPERM sob sandbox); os
// valores nunca são impressos e exit(1) em PT-BR quando ausentes.

// ----------------------------------------------------------------------- GraphQL
let KEY = '';

async function gql(query, variables = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: KEY },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.errors?.length) {
    throw new Error('GraphQL: ' + body.errors.map((e) => e.message).join('; '));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return body.data;
}

// ------------------------------------------------------- derivação da entrada (pura)
// Fonte única: comentário de fechamento mais recente com H2 (8.f/8.c). Card Done
// sem comentário estruturado → entrada mínima (D7 §Guardas), nunca travar.

export function secoesDoComentario(corpo) {
  const secoes = {};
  const rotulos = [
    ['diagnostico', /^(?:#+\s*)?###?\s*(?:Diagn[óo]stico(?:\s*\/\s*Decis[ãa]o)?|Decis[ãa]o)\b/i],
    ['arquivos', /^(?:#+\s*)?###?\s*(?:Arquivos?\s+alterados?|O que mudou)\b/i],
    ['testes', /^(?:#+\s*)?###?\s*(?:Testes(?:\s+executados)?)\b/i],
    ['limitacoes', /^(?:#+\s*)?###?\s*(?:Limita[çc][õo]es(?:\s*e\s+pend[êe]ncias)?)\b/i],
  ];
  const linhas = String(corpo || '').split('\n');
  let atual = null;
  let viuTitulo = false;
  for (const linha of linhas) {
    const achou = rotulos.find(([, re]) => re.test(linha.trim()));
    if (achou) {
      atual = achou[0];
      secoes[atual] = [];
      continue;
    }
    if (/^#{1,3}\s/.test(linha.trim())) {
      if (!viuTitulo) {
        viuTitulo = true;
        atual = 'diagnostico'; // prosa de contexto logo após o título H2 = diagnóstico/decisão
        secoes[atual] = secoes[atual] || [];
        continue;
      }
      atual = null; // qualquer outro H2/H3 encerra a seção anterior
      continue;
    }
    if (atual) secoes[atual].push(linha);
  }
  for (const k of Object.keys(secoes)) secoes[k] = secoes[k].join('\n').trim();
  return secoes;
}

export function textoEntrada(card) {
  const titulo = card.titulo.replace(/^\[[A-Z]+-\d+\]\s*/, '');
  const prefixo = `${card.card_id} (${titulo})`;
  const secoes = card.comentario ? secoesDoComentario(card.comentario) : {};
  const partes = [`CARD ${prefixo}:`];
  if (secoes.diagnostico) partes.push(`Diagnóstico/decisão: ${secoes.diagnostico}`);
  if (secoes.arquivos) partes.push(`Arquivos: ${secoes.arquivos}`);
  if (secoes.testes) partes.push(`Testes: ${secoes.testes}`);
  if (secoes.limitacoes) partes.push(`Limitações: ${secoes.limitacoes}`);
  let texto = partes.join('\n');
  if (texto.length <= `CARD ${prefixo}:`.length + 1) {
    // entrada mínima da D7: título + arquivos do SSOT (card Done sem 8.f)
    const arquivos = card.arquivos_ssot?.length ? `Arquivos: ${card.arquivos_ssot.join(', ')}` : '';
    texto = [`CARD ${prefixo}:`, arquivos].filter(Boolean).join('\n');
  }
  if (texto.length > TETO_TEXTO) texto = `${texto.slice(0, TETO_TEXTO - 1).trimEnd()}…`;
  return texto;
}

export function colecaoEtipo(card) {
  const m = card.card_id.match(/^([A-Z]+)-/);
  const prefixo = m ? m[1] : '';
  const labelTipo = (card.labels || []).find((l) => /^tipo:/.test(l));
  return {
    colecao: COLECAO_POR_PREFIXO[prefixo] || null,
    tipo: labelTipo ? labelTipo.slice(5) : TIPO_POR_PREFIXO[prefixo] || null,
  };
}

// -------------------------------------------------------------- SSOTs locais (leitura)
// docs/<categoria>/backlog-2026.json — somente leitura; SUPB não tem SSOT local.

function dadosDoSsot(card) {
  const prefixo = card.card_id.match(/^([A-Z]+)-/)?.[1] || '';
  const pasta = { AUDT: 'auditoria', BUG: 'bugs', IMPR: 'melhorias', TASK: 'tarefas' }[prefixo];
  if (!pasta) return { release_real: null, arquivos: [] };
  const caminho = join(RAIZ, 'docs', pasta, 'backlog-2026.json');
  if (!existsSync(caminho)) return { release_real: null, arquivos: [] };
  const json = JSON.parse(readFileSync(caminho, 'utf8'));
  const itens = json.achados || json.itens || [];
  const achado = itens.find((x) => x.id === card.card_id);
  return {
    release_real: achado?.release_real || null,
    arquivos: achado?.arquivos || [],
  };
}

// ------------------------------------------------------------------- exportação Linear
// Cards Done = moradores dos projetos Dones-N (mesma regra do cemitério do
// linear-backlog.mjs). Leitura pura: nenhuma mutação neste script.

async function exportarDone() {
  const projs = await gql('query { projects(first: 250) { nodes { id name status { name } } } }');
  const dones = projs.projects.nodes.filter((p) => DONES_REGEXP.test(p.name));
  if (dones.length === 0) throw new Error('Nenhum projeto Dones-N encontrado.');
  const brutas = [];
  for (const p of dones) {
    let cursor = null;
    for (;;) {
      const page = await gql(
        `query ($id: String!, $after: String) { project(id: $id) { issues(first: 50, after: $after) { nodes { id identifier title labels(first: 30) { nodes { name } } comments(first: 250) { nodes { body createdAt } } } pageInfo { hasNextPage endCursor } } } }`,
        { id: p.id, after: cursor }
      );
      for (const i of page.project.issues.nodes) brutas.push({ ...i, projeto: p.name });
      if (!page.project.issues.pageInfo.hasNextPage) break;
      cursor = page.project.issues.pageInfo.endCursor;
    }
  }
  return brutas;
}

function comentarioDeFechamento(comments) {
  const ordenados = [...(comments || [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const achado = ordenados.find((c) => /^##\s/m.test(c.body));
  return achado ? { corpo: achado.body, data: achado.createdAt?.slice(0, 10) || null } : null;
}

function normalizar(issueBruta) {
  // O identifier do Linear é a sequência do time (DIN-NN); o id canônico do
  // SSOT vive no prefixo [<id>] do título (AGENTS/padrão). Sem prefixo no
  // título: card não padronizado, não capturado (D7 v1).
  const m = String(issueBruta.title || '').match(/^\[([A-Z]+-\d+)\]/);
  if (!m) return null;
  const fechamento = comentarioDeFechamento(issueBruta.comments?.nodes);
  return {
    card_id: m[1],
    titulo: issueBruta.title,
    labels: (issueBruta.labels || []).nodes.map((l) => l.name),
    comentario: fechamento?.corpo || null,
    data_fechamento: fechamento?.data || null,
    projeto: issueBruta.projeto,
  };
}

// ----------------------------------------------------------------------- pipeline
async function main() {
  const brutas = await exportarDone();
  const cards = brutas.map(normalizar).filter(Boolean);
  const naoPadronizados = brutas.length - cards.length;
  console.log(
    `cards Done exportados: ${brutas.length} (${[...new Set(brutas.map((c) => c.projeto))].join(', ')})` +
      (naoPadronizados ? ` — ${naoPadronizados} sem prefixo [<id>], pulados` : '')
  );

  const entradas = cards.map((card) => {
    const ssot = dadosDoSsot(card);
    const { colecao, tipo } = colecaoEtipo(card);
    return {
      id: uuidV5(`memoria:${card.card_id}`),
      card_id: card.card_id,
      colecao,
      tipo,
      titulo: card.titulo,
      texto_entrada: textoEntrada({ ...card, arquivos_ssot: ssot.arquivos }),
      release_real: ssot.release_real,
      data: card.data_fechamento,
    };
  });

  const semColecao = entradas.filter((e) => !e.colecao);
  if (semColecao.length) {
    console.error(`FALHOU: prefixos sem roteamento D7: ${semColecao.map((e) => e.card_id).join(', ')}`);
    process.exit(1);
  }

  const porColecao = {};
  for (const e of entradas) {
    porColecao[e.colecao] = porColecao[e.colecao] || [];
    porColecao[e.colecao].push(e);
  }
  for (const [colecao, lista] of Object.entries(porColecao)) {
    console.log(`\n${colecao}: ${lista.length} entrada(s)`);
    for (const e of lista) {
      console.log(
        `  ${e.card_id} | tipo ${e.tipo} | release_real ${JSON.stringify(e.release_real)} | texto ${e.texto_entrada.length} chars | id ${e.id.slice(0, 8)}…`
      );
    }
  }

  if (DRY_RUN) {
    console.log('\nDRY-RUN concluído: nenhuma escrita no Qdrant, nenhum embed rodado.');
    process.exit(0);
  }

  // ---------------------------------------------------------- embed (modelo D3)
  const qdrant = resolveQdrantEnv();
  if (!qdrant) {
    console.error('FALHOU: QDRANT_URL/QDRANT_API_KEY ausentes (env ou registro HKCU).');
    process.exit(1);
  }
  const headersQ = { 'api-key': qdrant.apiKey, 'Content-Type': 'application/json' };

  const dirTemp = mkdtempSync(join(tmpdir(), 'rag-backfill-'));
  try {
    const arquivoEntrada = join(dirTemp, 'entradas.json');
    const arquivoSaida = join(dirTemp, 'pontos.json');
    const conteudo = Object.values(porColecao).flat();
    // embed.py espera chunks no formato [{ id, text, payload }] e devolve
    // [{ id, vector, payload }] preservando o payload (D2/D3).
    const paraEmbed = conteudo.map((e) => ({
      id: e.id,
      text: e.texto_entrada,
      payload: {
        card_id: e.card_id,
        tipo: e.tipo,
        titulo: e.titulo,
        texto_entrada: e.texto_entrada,
        release_real: e.release_real,
        data: e.data,
      },
    }));
    writeFileSync(arquivoEntrada, JSON.stringify(paraEmbed), 'utf8');
    // Ambiente Python local do repositório: deps em .rag-libs (PYTHONPATH) e
    // cache de modelo HuggingFace em .rag-cache (HF_HOME) — nada gravado fora
    // do workspace (o site-packages da Store Python derruba o wheel do torch
    // por WinError 206, caminho > 260 chars). Ambos são gitignored.
    const py = spawnSync('python', ['scripts/rag/embed.py', arquivoEntrada, arquivoSaida], {
      cwd: RAIZ,
      encoding: 'utf8',
      env: {
        ...process.env,
        PYTHONPATH: join(RAIZ, '.rag-libs'),
        HF_HOME: join(RAIZ, '.rag-cache'),
      },
    });
    if (py.status !== 0) {
      console.error((py.stderr || py.stdout || 'embed.py falhou sem stderr').slice(-1500));
      process.exit(1);
    }
    console.log((py.stdout || '').trim().split('\n').pop());
    const pontos = JSON.parse(readFileSync(arquivoSaida, 'utf8'));

    // --------------------------------------------------------- upsert por coleção
    const contar = async (colecao) => {
      const r = await fetch(`${qdrant.url}/collections/${colecao}/points/count`, {
        method: 'POST',
        headers: headersQ,
        body: JSON.stringify({ exact: true }),
      });
      const j = await r.json();
      return j.result?.count ?? j.count;
    };
    for (const [colecao, lista] of Object.entries(porColecao)) {
      const ids = new Set(lista.map((e) => e.id));
      const pontosColecao = pontos.filter((p) => ids.has(p.id));
      if (pontosColecao.length !== lista.length) {
        throw new Error(`${colecao}: embed retornou ${pontosColecao.length}/${lista.length} pontos`);
      }
      const r = await fetch(`${qdrant.url}/collections/${colecao}/points?wait=true`, {
        method: 'PUT',
        headers: headersQ,
        body: JSON.stringify({ points: pontosColecao }),
      });
      const j = await r.json();
      if (j.result?.status !== 'completed') {
        throw new Error(`${colecao}: upsert não completou: ${JSON.stringify(j.status || j)}`);
      }
      const total = await contar(colecao);
      console.log(`${colecao}: ${lista.length} pontos upsertados (total na coleção: ${total})`);
    }
  } finally {
    rmSync(dirTemp, { recursive: true, force: true });
  }
  console.log('backfill concluído.');
}

// Guarda de execução direta: importar o módulo (testes) não dispara rede,
// embed nem upsert — só as funções puras ficam expostas.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  KEY = resolveApiKey(); // exit(1) em PT-BR se ausente; nunca imprime o valor
  await main().catch((e) => {
    console.error(`FALHOU: ${e.message}`);
    process.exit(1);
  });
}
