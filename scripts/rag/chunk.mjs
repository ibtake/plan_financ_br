/**
 * Chunker da fase 2 do RAG (design-rag-fase0.md, D2).
 *
 * Entrada: o repositório (walker com poda de pastas). Saída: lista de chunks,
 * cada um com o "cartão" que será embedado (caminho + símbolo + 1ª linha de
 * comentário + assinatura) e o payload mínimo do contrato 2.1 — o corpo do
 * código não vai para o Qdrant, só a localização (fetch vivo na resposta).
 *
 * Unidade = função/classe/const-flecha TOP-LEVEL, detectada por scan leve
 * (regex ancorada na coluna 0; nada de parser pesado no Actions). Função
 * interna (indentada) pertence à unidade que a contém. Linhas antes do
 * primeiro símbolo (imports/consts) viram a unidade "modulo" — nada se perde;
 * arquivo sem símbolo nenhum vira uma única unidade "modulo".
 *
 * Teto ~400 tokens por chunk (aproximação chars/4, documentada na D2):
 * unidade acima do teto vira janelas de 60 linhas com overlap de 10, com
 * sufixo "#wN" no símbolo.
 *
 * Id determinístico = UUID v5 de "repo:path:linha-inicial" — re-indexar não
 * duplica ponto (mesma propriedade da D7). UUID e não sha1 bruto porque o
 * Qdrant só aceita id inteiro sem sinal ou UUID.
 *
 * Uso:
 *   node scripts/rag/chunk.mjs                  → resumo de contagens
 *   node scripts/rag/chunk.mjs --json arquivo   → escreve os chunks (JSON)
 * Importável para teste: caminhoElegivel, unidadesDe, estimarTokens,
 * chunkRepositorio.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Namespace do v5: 16 bytes estáveis derivados do escopo do projeto.
const NAMESPACE_V5 = createHash('sha1').update('planejador-rag:v1').digest().subarray(0, 16);

function uuidV5(nome) {
  const h = createHash('sha1').update(NAMESPACE_V5).update(nome).digest();
  h[6] = (h[6] & 0x0f) | 0x50; // versão 5
  h[8] = (h[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const REPO = process.env.GITHUB_REPOSITORY || 'local/planejador';
const TETO_TOKENS = 400;
const JANELA = 60;
const OVERLAP = 10;
const LIMITE_ASSINATURA = 160;

// Allowlist da D2 (inventário real de 2026-08-31). As exclusões duras aplicam
// POR CIMA da allowlist — defesa em profundidade da D3: nada de ambiente,
// dump, backup ou tooling entra no índice nem que a regex da allowlist escorregue.
const ALLOWLIST = [
  { regex: /^src\/.+\.(js|jsx)$/, linguagem: 'js' },
  { regex: /^test\/.+\.(js|mjs)$/, linguagem: 'js' },
  { regex: /^vercel\+linear\/api\/.+\.js$/, linguagem: 'js' },
  { regex: /^supabase\/functions\/[^/]+\/index\.ts$/, linguagem: 'ts' },
];

const EXCLUSOES = [
  /(^|\/)\.env/,
  /(^|\/)(node_modules|dist|dumps|graphify-out|coverage|\.vercel|\.git|\.agents|\.claude|\.zcode|\.vscode|\.supabase)(\/|$)/,
  /(^|\/)migrations\//,
  /__backup__/,
];

// Devolve a linguagem quando o caminho é elegível, null quando não é.
export function caminhoElegivel(caminho) {
  const regra = ALLOWLIST.find((a) => a.regex.test(caminho));
  if (!regra) return null;
  if (EXCLUSOES.some((re) => re.test(caminho))) return null;
  return regra.linguagem;
}

// Pastas podadas no walker (custo e ruído); a fronteira final é sempre
// caminhoElegivel — esta lista é otimização, não regra de negócio.
const PASTAS_PODADAS = new Set([
  'node_modules', 'dist', 'dumps', 'graphify-out', 'coverage',
  '.vercel', '.git', '.supabase', '.agents', '.claude', '.zcode', '.vscode',
]);

function listarElegiveis(raiz) {
  const saida = [];
  const walk = (dir) => {
    let entradas;
    try {
      entradas = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entradas) {
      const cheio = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!PASTAS_PODADAS.has(ent.name)) walk(cheio);
        continue;
      }
      if (!ent.isFile()) continue;
      const rel = relative(raiz, cheio).split(sep).join('/');
      const linguagem = caminhoElegivel(rel);
      if (linguagem) saida.push({ rel, cheio, linguagem });
    }
  };
  walk(raiz);
  return saida;
}

// Coluna 0 abre unidade. Grupos: 1 = função, 2 = classe, 3 = const-flecha/função.
const RE_SIMBOLO =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*))|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/;

// Unidade = do cabeçalho até a linha anterior ao próximo cabeçalho (ou EOF).
// Scan leve por decisão da D2: parser de verdade no Actions é custo sem
// retorno para um índice que é cache.
export function unidadesDe(texto) {
  const linhas = texto.split('\n');
  const marcas = [];
  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(RE_SIMBOLO);
    if (m) marcas.push({ simbolo: m[1] || m[2] || m[3] || 'anon', inicio: i });
  }
  if (!marcas.length) {
    return {
      linhas,
      unidades: texto.trim()
        ? [{ simbolo: 'modulo', inicio: 0, fim: linhas.length - 1 }]
        : [],
    };
  }
  const unidades = [];
  if (marcas[0].inicio > 0) {
    unidades.push({ simbolo: 'modulo', inicio: 0, fim: marcas[0].inicio - 1 });
  }
  marcas.forEach((marca, idx) => {
    unidades.push({
      ...marca,
      fim: idx + 1 < marcas.length ? marcas[idx + 1].inicio - 1 : linhas.length - 1,
    });
  });
  return { linhas, unidades };
}

// Aproximação da D2 ("~400 tokens"): 4 chars por token serve para o teto,
// não é contador de BPE.
export function estimarTokens(texto) {
  return Math.ceil(texto.length / 4);
}

function explodirTeto(unidade, linhas) {
  const textoUnidade = linhas.slice(unidade.inicio, unidade.fim + 1).join('\n');
  if (estimarTokens(textoUnidade) <= TETO_TOKENS) return [unidade];
  const janelas = [];
  const passo = JANELA - OVERLAP;
  for (let i = unidade.inicio; i <= unidade.fim; i += passo) {
    const fim = Math.min(i + JANELA - 1, unidade.fim);
    janelas.push({
      simbolo: `${unidade.simbolo}#w${janelas.length + 1}`,
      inicio: i,
      fim,
    });
    if (fim === unidade.fim) break;
  }
  return janelas;
}

// Cartão embedado (D2): melhora o match entre pergunta em PT-BR e código
// sem embedar o corpo. Doc = linha de comentário imediatamente acima do
// cabeçalho (até 4 linhas para trás, pulando vazias).
function cartaoDe(caminho, simbolo, linhas, inicio) {
  const assinatura = (linhas[inicio] || '').trim().slice(0, LIMITE_ASSINATURA);
  let doc = '(sem comentário)';
  for (let i = inicio - 1; i >= Math.max(0, inicio - 4); i--) {
    const linha = linhas[i].trim();
    if (!linha) continue;
    if (/^(?:\/\/|\/\*|\*|#)/.test(linha)) doc = linha;
    break;
  }
  return `caminho: ${caminho} | símbolo: ${simbolo} | doc: ${doc} | assinatura: ${assinatura}`;
}

// Blob sha + data do último commit de cada arquivo: UM subprocesso por comando
// (redirect para arquivo temporário — capturar stdout por pipe é EPERM no
// sandbox Windows, mesmo padrão do qdrant-key.mjs).
// v2.29 (fix do sha divergente, DIN-49): o payload `sha_arquivo` agora é o
// BLOB sha (hash do conteúdo do arquivo) — é isso que a API `contents` devolve
// em `dados.sha` no webhook; antes indexávamos o COMMIT sha (`git log
// --pretty=%H`), que nunca casa com o blob sha, e 100% dos trechos de código
// morriam no check `sha divergente` (6/6 no DIN-49). `ls-tree -r HEAD` lista
// (modo, blob sha, caminho) por arquivo; `log` segue trazendo a data do último
// commit que tocou cada arquivo. Fora de um repo git devolve mapa vazio.
function mapaGit(raiz) {
  const mapa = new Map();
  const tmpLs = join(tmpdir(), `rag-ls-${process.pid}.tmp`);
  const tmpLog = join(tmpdir(), `rag-log-${process.pid}.tmp`);
  try {
    execSync(`git -C "${raiz}" ls-tree -r HEAD > "${tmpLs}"`, {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    for (const bruta of readFileSync(tmpLs, 'utf8').split('\n')) {
      const linha = bruta.trimEnd();
      if (!linha) continue;
      // Formato: <mode> SP <type> SP <sha> TAB <caminho>
      const m = linha.match(/^[0-9]+ \w+ ([0-9a-f]{40})\t(.+)$/);
      if (m) {
        const atual = mapa.get(m[2]) || { sha: '', data: '' };
        mapa.set(m[2], { sha: m[1], data: atual.data });
      }
    }
  } catch {
    /* sem git local (workspace não é repo) — sha fica vazio */
  } finally {
    try {
      unlinkSync(tmpLs);
    } catch {
      /* já removido */
    }
  }
  try {
    execSync(
      `git -C "${raiz}" log --pretty=format:%H%x09%cI --name-only > "${tmpLog}"`,
      { stdio: ['ignore', 'ignore', 'ignore'] },
    );
    let commit = null;
    for (const bruta of readFileSync(tmpLog, 'utf8').split('\n')) {
      const linha = bruta.trimEnd();
      if (!linha) continue;
      if (/^[0-9a-f]{40}\t/.test(linha)) {
        const [sha, data] = linha.split('\t');
        commit = { sha, data };
        continue;
      }
      if (commit && !mapa.get(linha)?.data) {
        const atual = mapa.get(linha) || { sha: '', data: '' };
        mapa.set(linha, { sha: atual.sha, data: commit.data });
      }
    }
  } catch {
    /* sem git local — data fica vazia */
  } finally {
    try {
      unlinkSync(tmpLog);
    } catch {
      /* já removido */
    }
  }
  return mapa;
}

function raizPadrao() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

export function chunkRepositorio(raiz = raizPadrao()) {
  const mapa = mapaGit(raiz);
  const chunks = [];
  for (const arq of listarElegiveis(raiz)) {
    const texto = readFileSync(arq.cheio, 'utf8');
    const { linhas, unidades } = unidadesDe(texto);
    const info = mapa.get(arq.rel) || { sha: '', data: '' };
    for (const bloco of unidades.flatMap((u) => explodirTeto(u, linhas))) {
      chunks.push({
        id: uuidV5(`${REPO}:${arq.rel}:${bloco.inicio + 1}`),
        text: cartaoDe(arq.rel, bloco.simbolo, linhas, bloco.inicio),
        payload: {
          repo: REPO,
          path: arq.rel,
          inicio: bloco.inicio + 1,
          fim: bloco.fim + 1,
          simbolo: bloco.simbolo,
          sha_arquivo: info.sha,
          data_commit: info.data,
          linguagem: arq.linguagem,
        },
      });
    }
  }
  // Asserção da D2: nenhum chunk nasce de arquivo fora da allowlist.
  for (const chunk of chunks) {
    if (!caminhoElegivel(chunk.payload.path)) {
      throw new Error(`chunk fora da allowlist: ${chunk.payload.path}`);
    }
  }
  return chunks;
}

const ehCli =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (ehCli) {
  const raiz = raizPadrao();
  const arquivos = listarElegiveis(raiz);
  const chunks = chunkRepositorio(raiz);
  const indice = process.argv.indexOf('--json');
  if (indice !== -1 && process.argv[indice + 1]) {
    const destino = resolve(process.argv[indice + 1]);
    writeFileSync(destino, JSON.stringify(chunks), 'utf8');
    console.log(`chunks escritos: ${chunks.length} → ${destino}`);
  }
  const porPrefixo = {};
  for (const c of chunks) {
    const prefixo = c.payload.path.split('/')[0];
    porPrefixo[prefixo] = (porPrefixo[prefixo] || 0) + 1;
  }
  console.log(
    `arquivos elegíveis: ${arquivos.length} | chunks: ${chunks.length} (repo ${REPO})`
  );
  console.log(`por pasta: ${JSON.stringify(porPrefixo)}`);
}
