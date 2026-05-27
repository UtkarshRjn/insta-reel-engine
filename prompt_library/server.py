"""FastAPI service for the prompt library.

Run from repo root:
    uvicorn prompt_library.server:app --port 4001 --reload
"""

from __future__ import annotations

import os
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .embed import EMBEDDING_MODEL
from .retrieve import index_stats, retrieve_similar
from .store import ping as qdrant_ping


app = FastAPI(title="Inspiration Retrieval", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3001"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/inspire")
def inspire(
    prompt: str = Query(..., min_length=1),
    k: int = Query(3, ge=1, le=20),
    mode: Literal["text", "image", "fused"] = Query("fused"),
    image_weight: float = Query(0.5, ge=0.0, le=1.0),
    has_music: bool | None = Query(None, description="Filter to posts with audio metadata"),
):
    try:
        results = retrieve_similar(
            prompt, k=k, mode=mode, image_weight=image_weight, has_music=has_music
        )
        return {
            "count": len(results),
            "mode": mode,
            "image_weight": image_weight if mode == "fused" else None,
            "results": results,
        }
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


@app.get("/inspire/stats")
def stats():
    return index_stats()


@app.get("/health")
def health():
    """Liveness probe — process is up, no dependency checks."""
    return {"status": "ok"}


@app.get("/ready")
def ready():
    """Readiness probe. 503s only when /inspire would definitely fail.

    Checks:
      - OPENAI_API_KEY set (extractor needs it)
      - JINA_API_KEY set (embedder needs it)
      - QDRANT_URL set + collection reachable
      - At least one point indexed under the current embedding model

    Quarantine semantics from Phase 1 carry over for free: Qdrant search is
    already filtered to the current EMBEDDING_MODEL, so rows from a previous
    model do not influence /inspire. They count toward `entries_total` but not
    `entries_current_model`, and we only fail readiness on the latter.
    """
    problems: list[str] = []
    warnings: list[str] = []

    for key in ("OPENAI_API_KEY", "JINA_API_KEY", "QDRANT_URL"):
        if not os.environ.get(key):
            problems.append(f"{key} is not set")

    qdrant_info: dict = {}
    try:
        qdrant_info = qdrant_ping()
    except Exception as err:
        problems.append(f"Qdrant ping failed: {err}")

    stats = index_stats()
    if stats["entries_current_model"] == 0:
        problems.append(
            f"0 points stamped {EMBEDDING_MODEL} — run python -m prompt_library.build_index"
        )

    stale = stats["entries_total"] - stats["entries_current_model"]
    if stale > 0:
        warnings.append(
            f"{stale} points exist from a previous embedding model — they are excluded "
            "from /inspire. Re-run build_index or delete the collection to clear them."
        )

    body = {**stats, "qdrant": qdrant_info, "warnings": warnings}
    if problems:
        raise HTTPException(status_code=503, detail={"problems": problems, **body})
    return {"status": "ready", **body}
