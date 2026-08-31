"""Lado Python do gate de paridade (design-rag-fase0.md, D1).

Roda no CI (job `paridade` do reindex-rag) e em máquina com
sentence-transformers instalado. Lê os textos fixos do arquivo que o
parity.mjs escreve (mesma fonte para os dois lados — nenhum texto
duplicado em código), embeda com o modelo ORIGINAL da D1 e devolve os
vetores por arquivo. Nenhum vetor vai para stdout.

Uso: python scripts/rag/parity-embed.py <textos.json> <saida.json>
"""

import json
import sys

from sentence_transformers import SentenceTransformer

MODELO_ORIGINAL = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


def main() -> int:
    if len(sys.argv) != 3:
        print("uso: parity-embed.py <textos.json> <saida.json>", file=sys.stderr)
        return 1
    textos_path, saida_path = sys.argv[1], sys.argv[2]

    with open(textos_path, encoding="utf-8") as f:
        textos = json.load(f)

    modelo = SentenceTransformer(MODELO_ORIGINAL)
    vetores = modelo.encode(textos, normalize_embeddings=True, show_progress_bar=False)

    with open(saida_path, "w", encoding="utf-8") as f:
        json.dump([[float(x) for x in v] for v in vetores], f)

    print(f"python: {len(vetores)} vetores, dim {len(vetores[0])} ({MODELO_ORIGINAL})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
