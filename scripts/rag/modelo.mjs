/**
 * Modelo de embedding do RAG (fase 5, revisão d) — fonte única do nome.
 *
 * Server-side no Qdrant Cloud Inference, dos dois lados (upsert e query):
 * o vetor é enviado/consultado como Inference Object { text, model } e os
 * prefixos e5 (`passage: `/`query: `) são injetados pelo serviço — texto
 * cru nos dois lados (canário 2026-09: cos(A,B)=1.000000, 384d confirmado).
 *
 * Fallback offline (fora do pipeline ativo): scripts/rag/embed.py roda
 * paraphrase-multilingual-MiniLM-L12-v2 localmente e EXIGE prefixos
 * manuais (`passage: `/`query: `) — só usar se o Cloud Inference ficar
 * indisponível no free tier (matriz 2.3: RAG mudo, nunca errado).
 */
export const MODELO_EMBED = 'intfloat/multilingual-e5-small';
export const DIM_EMBED = 384;
