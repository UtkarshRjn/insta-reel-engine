# Prompt library (Phase 1)

Standalone Python service that:
1. Extracts a high-fidelity FLUX-ready prompt from each image in `seeds.json` using GPT-4o vision
2. Embeds those prompts with `text-embedding-3-small`
3. Serves top-k cosine retrieval over HTTP

Completely separate from the Node API. Reads only `OPENAI_API_KEY` from the repo-root `.env`.

## Setup

```bash
cd prompt_library
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

(Use Python 3.13, not 3.14 — numpy wheels aren't published for 3.14 yet.)

## Build the index

1. Edit `seeds.json` — add `{ "image_url": "...", "notes": "..." }` entries for the viral posts you want to index.
2. From the **repo root**:
   ```bash
   source prompt_library/.venv/bin/activate
   python -m prompt_library.build_index
   ```
   Idempotent. Re-run after adding new seeds. Cost ~$0.005/post.

## Run the retrieval service

From the **repo root**:
```bash
source prompt_library/.venv/bin/activate
uvicorn prompt_library.server:app --port 4001 --reload
```

## Query

```bash
curl 'http://localhost:4001/inspire?prompt=cozy+autumn+european+travel&k=3' | jq
curl 'http://localhost:4001/inspire/stats'
```

## Files

| File | What |
|---|---|
| `seeds.json` | Manually curated input — edit this |
| `index.json` | Generated artifact (gitignored) |
| `config.py` | Paths + OpenAI client (loads repo-root `.env`) |
| `extract.py` | GPT-4o vision → structured prompt |
| `embed.py` | `text-embedding-3-small` + cosine helper (numpy) |
| `build_index.py` | CLI: incremental indexer |
| `retrieve.py` | Pure `retrieve_similar(query, k)` |
| `server.py` | FastAPI app on port 4001 |
