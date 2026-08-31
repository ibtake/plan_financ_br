/**
 * Fase 1 do RAG (vercel+linear/design-rag-fase0.md, seção 2.1): cria e
 * verifica as 3 coleções do cluster Qdrant free.
 *
 * Idempotente: coleção existente é apenas verificada, não recriada. Config
 * esperada: 384 dimensões, distância cosseno. Smoke test: 1 ponto dummy na
 * coleção `codigo` (upsert → leitura → delete → contagem zero), nunca
 * persistido.
 *
 * Segurança: credenciais via qdrant-key.mjs (env → registro HKCU), nunca
 * impressas; a saída mostra somente nomes, contagens e status.
 */
import { resolveQdrantEnv } from './qdrant-key.mjs';

const DIM = 384;
const SPECS = ['codigo', 'bugs_resolvidos', 'decisoes_arquitetura'];
const SMOKE_ID = 987654321;

const { url, apiKey } = resolveQdrantEnv();
const base = String(url).replace(/\/+$/, '');

async function qdrant(metodo, caminho, corpo) {
  const res = await fetch(base + caminho, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detalhe = json?.status?.error || `HTTP ${res.status}`;
    throw new Error(`${metodo} ${caminho}: ${detalhe}`);
  }
  return json.result;
}

try {
  console.log('Fase 1 RAG: cluster Qdrant + coleções (design-rag-fase0.md 2.1)');

  const lista = await qdrant('GET', '/collections');
  const existentes = new Set((lista?.collections || []).map((c) => c.name));

  for (const nome of SPECS) {
    if (existentes.has(nome)) {
      console.log(`já existia: ${nome}`);
      continue;
    }
    await qdrant('PUT', `/collections/${nome}`, {
      vectors: { size: DIM, distance: 'Cosine' },
    });
    console.log(`criada: ${nome}`);
  }

  // Verificação de config — deriva (dim/distance errados) falha alto.
  for (const nome of SPECS) {
    const info = await qdrant('GET', `/collections/${nome}`);
    const v = info?.config?.params?.vectors;
    const ok =
      v && Number(v.size) === DIM && String(v.distance).toLowerCase() === 'cosine';
    if (!ok) {
      console.error(
        `FALHOU: ${nome} com config inesperada (esperado ${DIM}d cosine): ` +
          JSON.stringify(v || null)
      );
      process.exit(1);
    }
    console.log(
      `verificada: ${nome} (${v.size}d ${v.distance}, ${info.points_count} pontos)`
    );
  }

  // Smoke: ponto dummy em `codigo`, confirmado por leitura e apagado.
  const vetor = Array.from({ length: DIM }, (_, i) => ((i % 7) - 3) / 100);
  await qdrant('PUT', '/collections/codigo/points?wait=true', {
    points: [
      { id: SMOKE_ID, vector: vetor, payload: { repo: 'smoke', path: '__smoke__/fase1' } },
    ],
  });
  const lido = await qdrant('POST', '/collections/codigo/points', {
    ids: [SMOKE_ID],
    with_payload: true,
  });
  if (!lido?.[0]?.payload?.path) throw new Error('smoke: ponto não lido após upsert');
  await qdrant('POST', '/collections/codigo/points/delete?wait=true', {
    points: [SMOKE_ID],
  });
  const contagem = await qdrant('POST', '/collections/codigo/points/count', {
    exact: true,
    filter: { must: [{ has_id: [SMOKE_ID] }] },
  });
  if (Number(contagem?.count) !== 0) {
    throw new Error('smoke: ponto dummy sobreviveu ao delete');
  }
  console.log('smoke ok: upsert → leitura → delete confirmados na coleção codigo');

  console.log(`OK: fase 1 concluída — 3 coleções ${DIM}d cosine, cluster ${base.length ? 'respondendo' : '(sem url?)'}`);
  process.exit(0);
} catch (e) {
  console.error('FALHOU: ' + String(e && e.message ? e.message : e));
  process.exit(1);
}
