// Check read-only, três validações:
// 1. Os selos de versão do estilo de comentários (§8.g) precisam casar entre o padrão
//    (docs/PADRAO-LINEAR.md), o prompt STYLE do webhook (vercel+linear/api/linear-webhook.js)
//    e a arquitetura do webhook (docs/webhook/ARQUITETURA.md).
// 2. A versão e a data no topo do padrão precisam ser as da primeira entrada do Histórico,
//    e o Histórico precisa estar em ordem estritamente decrescente (sem repetição).
// 3. A arquitetura precisa referenciar a versão vigente do padrão no cabeçalho.
// Uso: node scripts/linear-style-check.mjs
// Falha (exit 1) em qualquer divergência. No padrão, selos citados no Histórico são
// ignorados (a versão vigente é validada só no corpo, antes da linha **Histórico…**).
// Sem rede, sem segredo, sem escrita.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAMINHO_PADRAO = join(raiz, 'docs', 'PADRAO-LINEAR.md');
const CAMINHO_WEBHOOK = join(raiz, 'vercel+linear', 'api', 'linear-webhook.js');
const CAMINHO_ARQUITETURA = join(raiz, 'docs', 'webhook', 'ARQUITETURA.md');

const alvosSelo = [
  ['padrão', CAMINHO_PADRAO],
  ['webhook', CAMINHO_WEBHOOK],
  ['arquitetura', CAMINHO_ARQUITETURA],
];

// Linha que abre o Histórico do padrão: `**Histórico:**` ou `**Histórico (...):**`.
const RE_HISTORICO = /^\*\*Histórico\b[^\n]*\*\*/m;
const RE_SELO = /estilo 8\.g v(\d+\.\d+)/g;
const RE_VERSAO_TOPO = /^\*\*Versão:\*\* (\d+\.\d+) · \*\*Data:\*\* (\d{4}-\d{2}-\d{2})/m;
// Entrada do Histórico nos dois formatos: `- v2.9 (2026-08-29)` e `- **v2.9 (2026-08-29)**`.
const RE_ENTRADA = /^- \**v(\d+\.\d+) \((\d{4}-\d{2}-\d{2})\)/gm;
const RE_REF_PADRAO = /`docs\/PADRAO-LINEAR\.md` v(\d+\.\d+)/;

let falhas = 0;
const erro = (msg) => {
  console.error(`[style-check] ${msg}`);
  falhas += 1;
};
const ok = (msg) => console.log(`style-check OK: ${msg}`);

function ler(nome, caminho) {
  try {
    return readFileSync(caminho, 'utf8');
  } catch (e) {
    erro(`${nome}: não consegui ler ${caminho} (${e.message})`);
    return null;
  }
}

function corpoSemHistorico(texto) {
  const m = texto.match(RE_HISTORICO);
  return m ? texto.slice(0, m.index) : texto;
}

function versaoMaior(a, b) {
  const [ma, na] = a.split('.').map(Number);
  const [mb, nb] = b.split('.').map(Number);
  return ma !== mb ? ma > mb : na > nb;
}

// ---------------------------------------------------------------------------
// Bloco 1: selo "estilo 8.g vN.N" igual em todos os alvos
// ---------------------------------------------------------------------------
{
  const antes = falhas;
  const selos = [];
  for (const [nome, caminho] of alvosSelo) {
    const texto = ler(nome, caminho);
    if (texto === null) continue;
    const achados = [...new Set([...corpoSemHistorico(texto).matchAll(RE_SELO)].map((m) => m[1]))];
    if (achados.length !== 1) {
      erro(
        `${nome} (${caminho}): esperado exatamente 1 selo "estilo 8.g vN.N", ` +
          `encontrado ${achados.length === 0 ? 'nenhum' : achados.join(' e ')}`
      );
      continue;
    }
    selos.push({ nome, valor: achados[0] });
  }
  if (falhas === antes && selos.length === alvosSelo.length) {
    const distintos = [...new Set(selos.map((s) => s.valor))];
    if (distintos.length > 1) {
      erro(
        `selos divergentes: ${selos.map((s) => `${s.nome} v${s.valor}`).join(' ≠ ')} — ` +
          'sincronize os três arquivos no mesmo commit antes do push.'
      );
    } else {
      ok(`estilo 8.g v${distintos[0]} (${selos.map((s) => s.nome).join(' = ')})`);
    }
  }
}

// ---------------------------------------------------------------------------
// Bloco 2: versão/data do topo do padrão = primeira entrada do Histórico; ordem decrescente
// ---------------------------------------------------------------------------
let versaoPadrao = null;
{
  const antes = falhas;
  const padrao = ler('padrão', CAMINHO_PADRAO);
  if (padrao !== null) {
    const topo = padrao.match(RE_VERSAO_TOPO);
    const hist = padrao.match(RE_HISTORICO);
    if (!topo) erro('padrão: cabeçalho "**Versão:** N.N · **Data:** AAAA-MM-DD" não encontrado');
    if (!hist) erro('padrão: linha "**Histórico:**" (ou "**Histórico (...):**") não encontrada');

    if (topo && hist) {
      versaoPadrao = topo[1];
      const entradas = [...padrao.slice(hist.index).matchAll(RE_ENTRADA)].map((m) => ({
        versao: m[1],
        data: m[2],
      }));

      if (entradas.length === 0) {
        erro('padrão: nenhuma entrada "- vN.N (AAAA-MM-DD)" encontrada no Histórico');
      } else {
        const [primeira] = entradas;
        if (primeira.versao !== topo[1]) {
          erro(`padrão: versão do topo v${topo[1]} ≠ primeira entrada do Histórico v${primeira.versao}`);
        }
        if (primeira.data !== topo[2]) {
          erro(
            `padrão: data do topo ${topo[2]} ≠ data da primeira entrada do Histórico ` +
              `${primeira.data} (v${primeira.versao})`
          );
        }
        for (let i = 1; i < entradas.length; i += 1) {
          const ant = entradas[i - 1].versao;
          const cur = entradas[i].versao;
          if (!versaoMaior(ant, cur)) {
            erro(
              `padrão: Histórico fora de ordem decrescente — v${ant} seguida de v${cur} ` +
                '(ordene do mais recente para o mais antigo; versão repetida também cai aqui)'
            );
            break;
          }
        }
        if (falhas === antes) {
          ok(`padrão v${topo[1]} (${topo[2]}) = primeira entrada do Histórico; ${entradas.length} entradas em ordem`);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Bloco 3: arquitetura referencia a versão vigente do padrão
// ---------------------------------------------------------------------------
if (versaoPadrao !== null) {
  const antes = falhas;
  const arq = ler('arquitetura', CAMINHO_ARQUITETURA);
  if (arq !== null) {
    const ref = arq.match(RE_REF_PADRAO);
    if (!ref) {
      erro('arquitetura: referência "`docs/PADRAO-LINEAR.md` vN.N" não encontrada no cabeçalho');
    } else if (ref[1] !== versaoPadrao) {
      erro(
        `arquitetura referencia o padrão v${ref[1]}, mas o padrão vigente é v${versaoPadrao} — ` +
          'atualize o cabeçalho de docs/webhook/ARQUITETURA.md'
      );
    }
    if (falhas === antes) ok(`arquitetura referencia padrão v${versaoPadrao}`);
  }
}

process.exit(falhas > 0 ? 1 : 0);