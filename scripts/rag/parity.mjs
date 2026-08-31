/**
 * Gate de paridade Node x Python (design-rag-fase0.md, D1) — BLOQUEANTE.
 *
 * Os 3 textos fixos passam pelos dois lados:
 *   Node   → @huggingface/transformers com o espelho ONNX
 *            Xenova/paraphrase-multilingual-MiniLM-L12-v2 (o que roda na
 *            Vercel na fase 5, no embed da consulta);
 *   Python → sentence-transformers com o modelo original
 *            sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
 *            (o que gera o índice no Actions).
 * Cada par precisa dar cosine > 0.999. Divergência de tokenizer/pooling
 * significa índice e consulta medidos em régua diferente — falha silenciosa
 * de recuperação —, por isso este gate roda ANTES de qualquer upsert e o job
 * de reindex no Actions tem `needs: paridade`.
 *
 * Vetores via ONNX em fp32 (quantized=false / dtype fp32): o gate compara
 * régua com régua; a quantização é decisão de produção calibrada na fase 5,
 * não atalho aqui.
 *
 * Troca de arquivos, nunca de pipe (capturar stdout de subprocesso é EPERM no
 * sandbox Windows; mesmo padrão do qdrant-key.mjs e do chunker). Temporários
 * são apagados no finally.
 *
 * Uso: node scripts/rag/parity.mjs [--python python3]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODELO_ONNX = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const MIN_COSINE = 0.999;

// Os 3 textos fixos do gate: prosa PT-BR de bug de valor, cartão de chunk de
// código e misto (Edge Function + termos técnicos). Mudou texto aqui, mudou o
// gate — deve ser estável.
const TEXTOS = [
  'O relatório mensal mostra um valor errado na categoria alimentação: gastei 150,00 e aparece 1.500,00. Suspeito da fórmula da variação percentual entre o orçado e o realizado.',
  'caminho: src/utils/format.js | símbolo: parseAmount | doc: leitura de valor digitado nos dois formatos | assinatura: export function parseAmount(valorDigitado)',
  'A Edge Function analise-mensal agrega transações por categoria e mês; o vencimento do dia 31 desaparecia em fevereiro porque a comparação usava data exata em vez de clamp no último dia do mês.',
];

function cosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function vetoresNode(textos) {
  let mod;
  try {
    mod = await import('@huggingface/transformers');
  } catch {
    console.error(
      'ERRO: @huggingface/transformers não instalado. Rode: npm i --no-save @huggingface/transformers'
    );
    process.exit(1);
  }
  const extrator = await mod.pipeline('feature-extraction', MODELO_ONNX, {
    dtype: 'fp32',
  });
  const saida = await extrator(textos, { pooling: 'mean', normalize: true });
  const dim = saida.dims[saida.dims.length - 1];
  const vetores = [];
  for (let t = 0; t < textos.length; t++) {
    vetores.push(Array.from(saida.data.slice(t * dim, (t + 1) * dim)));
  }
  return vetores;
}

const args = process.argv.slice(2);
const indicePython = args.indexOf('--python');
const cmdPython = indicePython !== -1 ? args[indicePython + 1] : 'python';
// --node-only: smoke local sem Python (máquina sem torch). Não é o gate —
// só valida o lado Node (dims, finitude, norma ~1); a paridade completa roda
// no job `paridade` do Actions.
const nodeOnly = args.includes('--node-only');

const pastaRag = dirname(fileURLToPath(import.meta.url));
const scriptPy = join(pastaRag, 'parity-embed.py');
const arquivoTextos = join(tmpdir(), `rag-parity-textos-${process.pid}.json`);
const arquivoNode = join(tmpdir(), `rag-parity-node-${process.pid}.json`);
const arquivoPy = join(tmpdir(), `rag-parity-python-${process.pid}.json`);

try {
  writeFileSync(arquivoTextos, JSON.stringify(TEXTOS), 'utf8');
  console.log('gate de paridade D1: Node (espelho ONNX) x Python (modelo original)');

  const node = await vetoresNode(TEXTOS);
  writeFileSync(arquivoNode, JSON.stringify(node), 'utf8');
  console.log(`node: ${node.length} vetores, dim ${node[0].length} (${MODELO_ONNX}, fp32)`);

  if (node.length !== TEXTOS.length || node[0].length !== 384) {
    throw new Error(`saída Node inesperada: ${node.length} vetores, dim ${node[0].length} (esperado 3 x 384)`);
  }
  for (let t = 0; t < node.length; t++) {
    const norma = Math.sqrt(node[t].reduce((s, x) => s + x * x, 0));
    if (!node[t].every(Number.isFinite) || Math.abs(norma - 1) > 1e-3) {
      throw new Error(`vetor ${t + 1} do Node inválido (norma ${norma.toFixed(4)}, finitude falhou)`);
    }
  }

  if (nodeOnly) {
    console.log('modo --node-only: lado Node íntegro (norma ~1, 384d); paridade completa roda no CI');
    process.exit(0);
  }

  execFileSync(cmdPython, [scriptPy, arquivoTextos, arquivoPy], { stdio: 'inherit' });
  const py = JSON.parse(readFileSync(arquivoPy, 'utf8'));

  if (!Array.isArray(py) || py.length !== node.length) {
    throw new Error(`contagens divergem: node ${node.length} x python ${py.length}`);
  }
  if (py[0].length !== node[0].length) {
    throw new Error(`dims divergem: node ${node[0].length} x python ${py[0].length}`);
  }

  let minimo = 1;
  for (let t = 0; t < TEXTOS.length; t++) {
    const c = cosine(node[t], py[t]);
    minimo = Math.min(minimo, c);
    console.log(`texto ${t + 1}: cosine ${c.toFixed(6)}`);
  }
  if (minimo <= MIN_COSINE) {
    throw new Error(
      `PARIDADE FALHOU: mínimo ${minimo.toFixed(6)} <= gate ${MIN_COSINE} — ` +
        'tokenizer/pooling divergentes; nada foi escrito no Qdrant'
    );
  }
  console.log(`gate PASSOU: mínimo ${minimo.toFixed(6)} > ${MIN_COSINE}`);
  process.exit(0);
} catch (e) {
  if (e && e.code === 'ENOENT') {
    console.error(
      `FALHOU: python não encontrado ("${cmdPython}"). Ajuste com --python <cmd> ` +
        '(no CI o setup-python fornece).'
    );
  } else {
    console.error('FALHOU: ' + String(e && e.message ? e.message : e));
  }
  process.exit(1);
} finally {
  for (const f of [arquivoTextos, arquivoNode, arquivoPy]) {
    try {
      unlinkSync(f);
    } catch {
      /* já removido */
    }
  }
}
