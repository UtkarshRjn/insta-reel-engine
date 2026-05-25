"""FastAPI service exposing /inspire and /inspire/stats.

Run from repo root:
    uvicorn prompt_library.server:app --port 4001 --reload
"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .retrieve import retrieve_similar, index_stats

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
    return {"status": "ok"}
