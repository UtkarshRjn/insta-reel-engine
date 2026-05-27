"""Pure retrieval: load index, embed a query, return top-k by cosine.

Defends against version-skew: entries whose `embedding_model` or `embedding_dim` don't
match the current configuration are quarantined and skipped rather than crashing the
whole service. This way, one stale row from a previous embedding model never takes
the retrieval API offline.
"""

import json
from functools import lru_cache

import numpy as np

from .config import INDEX_PATH
from .embed import EMBEDDING_DIM, EMBEDDING_MODEL, cosine_matrix, embed


def _load_index_raw() -> list[dict]:
    if not INDEX_PATH.exists():
        return []
    return json.loads(INDEX_PATH.read_text())


def _partition_entries(entries: list[dict]) -> tuple[list[dict], list[tuple[str, str]]]:
    """Split entries into (valid, rejected) based on schema + version checks."""
    valid: list[dict] = []
    rejected: list[tuple[str, str]] = []
    for e in entries:
        url = e.get("image_url", "?")
        vec = e.get("embedding")
        if not isinstance(vec, list):
            rejected.append((url, "missing or non-list embedding"))
            continue
        if e.get("embedding_model") != EMBEDDING_MODEL:
            rejected.append((url, f"model mismatch ({e.get('embedding_model')!r} != {EMBEDDING_MODEL!r})"))
            continue
        if e.get("embedding_dim") != EMBEDDING_DIM:
            rejected.append((url, f"dim mismatch ({e.get('embedding_dim')!r} != {EMBEDDING_DIM})"))
            continue
        if len(vec) != EMBEDDING_DIM:
            rejected.append((url, f"vector length {len(vec)} != {EMBEDDING_DIM}"))
            continue
        valid.append(e)
    return valid, rejected


# Cache key includes mtime so the cache invalidates when the file changes on disk.
@lru_cache(maxsize=1)
def _load_index_cached(mtime_key: float):
    raw = _load_index_raw()
    valid, rejected = _partition_entries(raw)
    matrix = (
        np.array([e["embedding"] for e in valid], dtype=np.float32)
        if valid
        else np.zeros((0, EMBEDDING_DIM), dtype=np.float32)
    )
    return valid, matrix, rejected


def _load_index():
    if not INDEX_PATH.exists():
        return [], np.zeros((0, EMBEDDING_DIM), dtype=np.float32), []
    return _load_index_cached(INDEX_PATH.stat().st_mtime)


def retrieve_similar(query: str, k: int = 3) -> list[dict]:
    if not query or not query.strip():
        return []
    entries, matrix, _rejected = _load_index()
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
    """Counts of valid + rejected entries plus the current expected embedding config."""
    entries, _matrix, rejected = _load_index()
    return {
        "entries": len(entries),
        "rejected": len(rejected),
        "rejected_reasons": [{"image_url": u, "reason": r} for u, r in rejected[:10]],
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dim": EMBEDDING_DIM,
    }
