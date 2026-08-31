"""Embedder do índice (fase 2; design-rag-fase0.md, D1 + D2).

Lê o JSON de chunks produzido por chunk.mjs (cartões da D2) e escreve o
JSON de pontos para o upsert.mjs: [{ id, vector, payload }] — payload junto
para um arquivo único atravessar o pipeline do workflow. Modelo ORIGINAL
(sentence-transformers) — a paridade com o espelho ONNX que roda na consulta
(fase 5) é garantida pelo gate D1, que roda antes no job `paridade`.

Uso: python scripts/rag/embed.py <chunks.json> <saida.json>
"""

import json
import sys

from sentence_transformers import SentenceTransformer

MODELO_ORIGINAL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def main() -> int:
    if len(sys.argv) != 3:
        print("uso: embed.py <chunks.json> <saida.json>", file=sys.stderr)
        return 1
    chunks_path, saida_path = sys.argv[1], sys.argv[2]

    with open(chunks_path, encoding="utf-8") as f:
        chunks = json.load(f)
    if not chunks:
        print("embed: nenhum chunk recebido — nada a fazer", file=sys.stderr)
        return 1

    modelo = SentenceTransformer(MODELO_ORIGINAL)
    textos = [c["text"] for c in chunks]
    vetores = modelo.encode(
        textos,
        batch_size=32,
        normalize_embeddings=True,
        show_progress_bar=True,
    )

    with open(saida_path, "w", encoding="utf-8") as f:
        json.dump(
            [
                {"id": c["id"], "vector": [float(x) for x in v], "payload": c["payload"]}
                for c, v in zip(chunks, vetores)
            ],
            f,
        )

    print(f"embed: {len(chunks)} vetores, dim {len(vetores[0])} ({MODELO_ORIGINAL})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
