"""OpenAI text embeddings + cosine similarity."""

import numpy as np
from openai import OpenAI

from .config import get_openai_client

EMBEDDING_MODEL = "text-embedding-3-small"  # 1536-d


def embed(text: str) -> list[float]:
    client: OpenAI = get_openai_client()
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=text)
    return response.data[0].embedding


def cosine_matrix(query: list[float], matrix: np.ndarray) -> np.ndarray:
    """Cosine similarity of a single query vector against a (N, D) matrix. Returns (N,) scores."""
    q = np.array(query, dtype=np.float32)
    q_norm = q / (np.linalg.norm(q) + 1e-9)
    m_norms = matrix / (np.linalg.norm(matrix, axis=1, keepdims=True) + 1e-9)
    return m_norms @ q_norm
