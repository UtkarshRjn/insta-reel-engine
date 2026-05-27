"""Qdrant-backed storage for the prompt library.

Replaces Phase 1's flat-file `index.json`. Each post-image is one Qdrant point
with two named vectors (`text` and `image`) plus a rich payload (caption,
music, hashtags, post URL, etc.) so retrieval can filter as well as score.

We use named vectors instead of two separate collections so a single Qdrant
point is the canonical record per (post, image_index) — that's what makes
upserts naturally idempotent via deterministic UUIDs from media_mirror.
"""

from __future__ import annotations

from typing import Iterable

from qdrant_client import QdrantClient
from qdrant_client.http import models as qm

from .config import QDRANT_COLLECTION, qdrant_endpoint
from .embed import EMBEDDING_DIM, EMBEDDING_MODEL


_client: QdrantClient | None = None


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        url, api_key = qdrant_endpoint()
        _client = QdrantClient(url=url, api_key=api_key, timeout=30.0)
    return _client


def ensure_collection() -> None:
    """Create the collection if it doesn't already exist. Idempotent."""
    client = get_client()
    existing = {c.name for c in client.get_collections().collections}
    if QDRANT_COLLECTION in existing:
        return
    client.create_collection(
        collection_name=QDRANT_COLLECTION,
        vectors_config={
            "text": qm.VectorParams(size=EMBEDDING_DIM, distance=qm.Distance.COSINE),
            "image": qm.VectorParams(size=EMBEDDING_DIM, distance=qm.Distance.COSINE),
        },
    )
    # An index on embedding_model lets `/inspire` cheaply filter out any rows
    # from a previous model version, the same way Phase 1's quarantine worked.
    client.create_payload_index(
        collection_name=QDRANT_COLLECTION,
        field_name="embedding_model",
        field_schema=qm.PayloadSchemaType.KEYWORD,
    )
    client.create_payload_index(
        collection_name=QDRANT_COLLECTION,
        field_name="shortcode",
        field_schema=qm.PayloadSchemaType.KEYWORD,
    )
    client.create_payload_index(
        collection_name=QDRANT_COLLECTION,
        field_name="has_music",
        field_schema=qm.PayloadSchemaType.BOOL,
    )


def upsert_point(
    *,
    point_id: str,
    text_vector: list[float],
    image_vector: list[float],
    payload: dict,
) -> None:
    client = get_client()
    client.upsert(
        collection_name=QDRANT_COLLECTION,
        points=[
            qm.PointStruct(
                id=point_id,
                vector={"text": text_vector, "image": image_vector},
                payload=payload,
            )
        ],
    )


def search(
    *,
    query_vec: list[float],
    using: str,           # "text" or "image"
    k: int,
    extra_filter: qm.Filter | None = None,
) -> list[qm.ScoredPoint]:
    """Score `query_vec` against either the text or image vectors.

    Always restricts results to points stamped with the *current* embedding
    model so a mid-migration collection still returns correct rankings.
    """
    base_filter = qm.Filter(
        must=[
            qm.FieldCondition(
                key="embedding_model",
                match=qm.MatchValue(value=EMBEDDING_MODEL),
            )
        ]
    )
    if extra_filter is not None:
        base_filter.must.extend(extra_filter.must or [])
        if extra_filter.should:
            base_filter.should = (base_filter.should or []) + list(extra_filter.should)
        if extra_filter.must_not:
            base_filter.must_not = (base_filter.must_not or []) + list(extra_filter.must_not)

    return get_client().search(
        collection_name=QDRANT_COLLECTION,
        query_vector=qm.NamedVector(name=using, vector=query_vec),
        limit=k,
        query_filter=base_filter,
        with_payload=True,
    )


def count_total() -> int:
    """Total points in the collection (any embedding_model)."""
    try:
        info = get_client().get_collection(QDRANT_COLLECTION)
        return info.points_count or 0
    except Exception:
        return 0


def count_current_model() -> int:
    """Points stamped with the current embedding model."""
    try:
        result = get_client().count(
            collection_name=QDRANT_COLLECTION,
            count_filter=qm.Filter(must=[
                qm.FieldCondition(
                    key="embedding_model",
                    match=qm.MatchValue(value=EMBEDDING_MODEL),
                )
            ]),
            exact=True,
        )
        return result.count or 0
    except Exception:
        return 0


def existing_point_ids(ids: Iterable[str]) -> set[str]:
    """Subset of the given ids that already exist in the collection.

    Used by build_index to skip work that has already been done (faster than
    re-extracting + re-embedding to find out it's a no-op upsert).
    """
    ids = list(ids)
    if not ids:
        return set()
    try:
        points = get_client().retrieve(
            collection_name=QDRANT_COLLECTION,
            ids=ids,
            with_payload=False,
            with_vectors=False,
        )
        return {str(p.id) for p in points}
    except Exception:
        return set()


def ping() -> dict:
    """Lightweight liveness probe for /ready. Raises on failure."""
    client = get_client()
    info = client.get_collection(QDRANT_COLLECTION)
    return {
        "collection": QDRANT_COLLECTION,
        "points_total": info.points_count or 0,
    }
