/**
 * Módulo puro do reindex delta (TASK-009): fingerprint e cálculo do delta
 * entre o estado desejado (chunks gerados do repo) e o estado real (records
 * armazenados no Pinecone).
 *
 * Princípio (criterio_aceite do card): embedding é determinístico — texto
 * idêntico produz vetor idêntico — então pular chunk inalterado produz
 * índice bit a bit igual ao rebuild completo. Delta é otimização de custo
 * (cada push deixaria de re-embedar ~500 textos idênticos), nunca corretude:
 * quem chama deve cair para rebuild completo quando a leitura do estado real
 * falhar ou devolver registros sem fingerprint.
 *
 * Fingerprint = sha256(text + '\n' + sha_arquivo): o blob sha entra no hash
 * de propósito. Sem ele, um chunk cujo corpo do arquivo mudou mas cujo
 * "cartão" (caminho + símbolo + doc + assinatura) ficou idêntico seria
 * pulado com o sha_arquivo velho no payload — e o webhook descartaria o
 * trecho vivo ("sha divergente") até o próximo full. Com o sha no hash,
 * qualquer commit que toque o arquivo re-embeda os chunks daquele arquivo.
 *
 * Importável para teste: zero rede, zero fs, zero env.
 */

import { createHash } from 'node:crypto';

export function fingerprintDe(texto, shaArquivo) {
  return createHash('sha256')
    .update(String(texto ?? '') + '\n' + String(shaArquivo ?? ''))
    .digest('hex');
}

/**
 * @param {Array<{id: string, text: string, payload: {sha_arquivo?: string}}>} desejados
 *   Chunks produzidos pelo chunkRepositorio (ids já resolvidos por transporte).
 * @param {Map<string, string>} existentes
 *   id → fingerprint armazenado no índice (vazio ou ausente = "desconhecido").
 * @returns {{aUpsertar: Array, aDeletar: string[], inalterados: number}}
 */
export function calcularDelta(desejados, existentes) {
  const mapa = existentes instanceof Map ? existentes : new Map(Object.entries(existentes || {}));
  const aUpsertar = [];
  const desejadosIds = new Set();

  for (const chunk of desejados) {
    desejadosIds.add(chunk.id);
    const atual = mapa.get(chunk.id);
    if (atual === undefined || atual === null || atual === '') {
      aUpsertar.push(chunk); // novo ou sem fingerprint (first run / formato antigo)
      continue;
    }
    const esperado = fingerprintDe(chunk.text, chunk.payload?.sha_arquivo);
    if (atual !== esperado) aUpsertar.push(chunk);
  }

  // IDs que estão no índice mas não estão mais na árvore: arquivo removido
  // ou renomeado. Delta não se ocupa deles — o chamador decide deletar.
  const aDeletar = [...mapa.keys()].filter((id) => !desejadosIds.has(id));

  return {
    aUpsertar,
    aDeletar,
    inalterados: desejados.length - aUpsertar.length,
  };
}
