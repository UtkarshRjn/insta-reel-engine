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

    Hard-fails (503) only on conditions that would make every /inspire call fail:
    missing OPENAI_API_KEY, index that can't be loaded, or zero usable entries.

    Quarantined rows (e.g. from a partial rebuild or an embedding-model upgrade in
    progress) are reported as warnings, NOT 503s, because retrieve.py is designed
    to keep serving from the remaining valid entries. Failing readiness on any
    rejected row would defeat the version-skew tolerance and turn a routine
    migration into a full outage.
    """
    problems = []
    warnings = []

    if not os.environ.get("OPENAI_API_KEY"):
        problems.append("OPENAI_API_KEY is not set")

    try:
        stats = index_stats()
    except Exception as err:
        raise HTTPException(status_code=503, detail=f"index load failed: {err}")

    if stats["entries"] == 0:
        problems.append("index has 0 usable entries — run build_index")

    if stats["rejected"] > 0:
        warnings.append(
            f"{stats['rejected']} entries quarantined due to schema/version mismatch — "
            "re-run build_index to clear them. /inspire still serves the valid rows."
        )

    if problems:
        raise HTTPException(status_code=503, detail={"problems": problems, "warnings": warnings, **stats})

    return {"status": "ready", "warnings": warnings, **stats}
