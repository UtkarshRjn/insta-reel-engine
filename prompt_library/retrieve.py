"""Pure retrieval: load index, embed a query, return top-k by cosine."""

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from .config import INDEX_PATH
from .embed import cosine_matrix, embed


def _load_index_raw() -> list[dict]:
    if not INDEX_PATH.exists():
        return []
    return json.loads(INDEX_PATH.read_text())


# Cache key includes mtime so the cache invalidates when the file changes.
@lru_cache(maxsize=1)
def _load_index_cached(mtime_key: float):
    entries = _load_index_raw()
    if not entries:
        return [], np.zeros((0, 0), dtype=np.float32)
    matrix = np.array([e["embedding"] for e in entries], dtype=np.float32)
    return entries, matrix


def _load_index():
    if not INDEX_PATH.exists():
        return [], np.zeros((0, 0), dtype=np.float32)
    return _load_index_cached(INDEX_PATH.stat().st_mtime)


def retrieve_similar(query: str, k: int = 3) -> list[dict]:
    if not query or not query.strip():
        return []
    entries, matrix = _load_index()
    if not entries:
        return []

    query_vec = embed(query)
    scores = cosine_matrix(query_vec, matrix)
    top_idx = np.argsort(-scores)[:k]

    results = []
    for i in top_idx:
        e = entries[int(i)]
        results.append({
            "image_url": e["image_url"],
            "prompt_text": e["prompt_text"],
            "structured": e["structured"],
            "notes": e.get("notes"),
            "score": float(scores[int(i)]),
        })
    return results


def index_stats() -> dict:
    entries = _load_index_raw()
    return {"entries": len(entries)}
