"""Jina CLIP v2 multimodal embeddings.

Both text and image embeddings are produced by the same model into the same
1024-dim space, which is what lets a text query like "cozy autumn travel"
score directly against image vectors.

Sticking to the managed API at api.jina.ai. If you ever need self-hosting,
override JINA_BASE_URL to point at your own gateway and re-use this module.
"""

from __future__ import annotations

import httpx
import numpy as np

from .config import JINA_BASE_URL, require_jina_key


EMBEDDING_MODEL = "jina-clip-v2"
EMBEDDING_DIM = 1024


def _post_embeddings(payload: dict) -> list[list[float]]:
    headers = {
        "Authorization": f"Bearer {require_jina_key()}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=60) as client:
        resp = client.post(f"{JINA_BASE_URL}/embeddings", json=payload, headers=headers)
    if resp.status_code >= 400:
        raise RuntimeError(f"Jina embeddings HTTP {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    return [row["embedding"] for row in data["data"]]


def embed_text(text: str) -> list[float]:
    """Embed a piece of text in the shared CLIP v2 space."""
    if not text or not text.strip():
        raise ValueError("embed_text called with empty text")
    vectors = _post_embeddings({
        "model": EMBEDDING_MODEL,
        "input": [{"text": text}],
    })
    return vectors[0]


def embed_image(image_url: str) -> list[float]:
    """Embed an image (by URL) in the same shared CLIP v2 space.

    Jina fetches the URL server-side, like OpenAI's vision endpoint. So the URL
    must be publicly reachable from Jina's network. After media_mirror.py runs,
    the URLs we pass here are R2 URLs, which are durable.
    """
    if not image_url:
        raise ValueError("embed_image called with empty URL")
    vectors = _post_embeddings({
        "model": EMBEDDING_MODEL,
        "input": [{"image": image_url}],
    })
    return vectors[0]


def cosine_matrix(query: list[float], matrix: np.ndarray) -> np.ndarray:
    """Cosine similarity of a query vector against an (N, D) matrix.

    Kept for migration scripts and ad-hoc analysis. Live retrieval goes through
    Qdrant.
    """
    q = np.array(query, dtype=np.float32)
    q_norm = q / (np.linalg.norm(q) + 1e-9)
    m_norms = matrix / (np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-9)
    return m_norms @ q_norm
