"""FastAPI service exposing /inspire and /inspire/stats.

Run from repo root:
    uvicorn prompt_library.server:app --port 4001 --reload
"""

import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .retrieve import index_stats, retrieve_similar

app = FastAPI(title="Inspiration Retrieval", version="0.1.0")

# Allow the Vite dev server and the Node API to call this if/when we wire them up later.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3001"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/inspire")
def inspire(prompt: str = Query(..., min_length=1), k: int = Query(3, ge=1, le=10)):
    try:
        results = retrieve_similar(prompt, k)
        return {"count": len(results), "results": results}
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))


@app.get("/inspire/stats")
def stats():
    return index_stats()


@app.get("/health")
def health():
    """Liveness probe. Process is up — no dependency checks."""
    return {"status": "ok"}


@app.get("/ready")
def ready():
    """Readiness probe. Validates that the service can actually serve a query.

    Returns 503 (with detail) if any prerequisite is missing, so an orchestrator
    won't route traffic to a misconfigured instance. Splits liveness vs readiness
    on purpose: a 200 here means /inspire can succeed for the next request,
    not just that the process is alive.
    """
    problems = []
    if not os.environ.get("OPENAI_API_KEY"):
        problems.append("OPENAI_API_KEY is not set")

    try:
        stats = index_stats()
    except Exception as err:
        raise HTTPException(status_code=503, detail=f"index load failed: {err}")

    if stats["entries"] == 0:
        problems.append("index has 0 usable entries — run build_index")
    if stats["rejected"] > 0:
        problems.append(
            f"{stats['rejected']} entries quarantined due to version mismatch — re-run build_index"
        )

    if problems:
        raise HTTPException(status_code=503, detail={"problems": problems, **stats})

    return {"status": "ready", **stats}
