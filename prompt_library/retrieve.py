"""Qdrant-backed dual-vector retrieval.

A query gets embedded once (always as text — that's how callers will use this)
and scored against either the text-side vectors, the image-side vectors, or a
weighted fusion of both. Because jina-clip-v2 places text and image embeddings
in the same space, text-vs-image cosine is meaningful.

All results are filtered to `embedding_model == jina-clip-v2` so a stale row
from a previous model never leaks into rankings.
"""

from __future__ import annotations

from typing import Literal

from qdrant_client.http import models as qm

from .embed import EMBEDDING_MODEL, embed_text
from .store import count_current_model, count_total, search


Mode = Literal["text", "image", "fused"]


def _payload_filter(*, has_music: bool | None = None) -> qm.Filter | None:
    must: list = []
    if has_music is True:
        must.append(qm.FieldCondition(key="has_music", match=qm.MatchValue(value=True)))
    elif has_music is False:
        must.append(qm.FieldCondition(key="has_music", match=qm.MatchValue(value=False)))
    if not must:
        return None
    return qm.Filter(must=must)


def _format_hit(point: qm.ScoredPoint) -> dict:
    p = point.payload or {}
    return {
        "score": float(point.score),
        "post_url": p.get("post_url"),
        "shortcode": p.get("shortcode"),
        "media_index": p.get("media_index"),
        "media_url": p.get("media_url"),
        "prompt_text": p.get("prompt_text"),
        "structured": p.get("structured"),
        "caption": p.get("caption"),
        "hashtags": p.get("hashtags") or [],
        "music": {
            "title": p.get("music_title"),
            "artist": p.get("music_artist"),
        } if p.get("has_music") else None,
        "like_count": p.get("like_count"),
        "comment_count": p.get("comment_count"),
        "owner_username": p.get("owner_username"),
        "posted_at": p.get("posted_at"),
    }


def retrieve_similar(
    query: str,
    k: int = 3,
    mode: Mode = "fused",
    image_weight: float = 0.5,
    has_music: bool | None = None,
) -> list[dict]:
    """Return top-k posts ranked by similarity to `query`.

    mode:
      - "text"   — score against text-side vectors only
      - "image"  — score against image-side vectors only (true visual retrieval)
      - "fused"  — weighted blend; `image_weight` in [0, 1]

    `has_music=True` restricts to posts where music_info was captured.
    """
    if not query or not query.strip():
        return []
    if k <= 0:
        return []
    if mode == "fused" and not (0.0 <= image_weight <= 1.0):
        raise ValueError("image_weight must be in [0, 1]")

    query_vec = embed_text(query.strip())
    extra = _payload_filter(has_music=has_music)

    if mode == "text":
        hits = search(query_vec=query_vec, using="text", k=k, extra_filter=extra)
        return [_format_hit(h) for h in hits]
    if mode == "image":
        hits = search(query_vec=query_vec, using="image", k=k, extra_filter=extra)
        return [_format_hit(h) for h in hits]

    # Fused: pull a larger candidate set from each, blend by point id, sort.
    candidates = max(k * 4, 12)
    text_hits = search(query_vec=query_vec, using="text", k=candidates, extra_filter=extra)
    image_hits = search(query_vec=query_vec, using="image", k=candidates, extra_filter=extra)

    by_id: dict[str, dict] = {}
    for h in text_hits:
        by_id[str(h.id)] = {"point": h, "text": h.score, "image": 0.0}
    for h in image_hits:
        if str(h.id) in by_id:
            by_id[str(h.id)]["image"] = h.score
        else:
            by_id[str(h.id)] = {"point": h, "text": 0.0, "image": h.score}

    blended = []
    for row in by_id.values():
        fused = image_weight * row["image"] + (1.0 - image_weight) * row["text"]
        point = row["point"]
        formatted = _format_hit(point)
        formatted["score"] = fused
        formatted["component_scores"] = {"text": row["text"], "image": row["image"]}
        blended.append(formatted)

    blended.sort(key=lambda r: r["score"], reverse=True)
    return blended[:k]


def index_stats() -> dict:
    """Counts plus the embedding config currently expected by retrieval."""
    return {
        "entries_current_model": count_current_model(),
        "entries_total": count_total(),
        "embedding_model": EMBEDDING_MODEL,
    }
