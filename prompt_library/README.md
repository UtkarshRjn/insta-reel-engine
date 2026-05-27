# Prompt library (Phase 2)

Standalone Python service that turns Instagram post URLs into searchable, FLUX-ready prompts:

1. **Fetch** a post via Apify (caption, hashtags, music, all carousel images). oEmbed fallback if no Apify token.
2. **Mirror** each image to Cloudflare R2 so the URLs survive IG CDN expiry.
3. **Extract** a structured prompt + 50–80-word `prompt_text` per image with GPT-4o vision, biased by the post's caption and music.
4. **Embed** both the text corpus (prompt + caption + hashtags + audio) and the image into the same 1024-dim space with `jina-clip-v2`.
5. **Store** as a Qdrant point with two named vectors (`text`, `image`) and a rich payload.
6. **Serve** top-k retrieval over HTTP, with `mode=text|image|fused` and `has_music` filtering.

Independent from the Node API: own venv, own port (4001), own gitignore. Shares R2 credentials and `OPENAI_API_KEY` from the repo-root `.env`.

## Setup

```bash
cd prompt_library
python3.13 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Use Python 3.13 — numpy and qdrant-client wheels aren't published for 3.14 yet.

## Required environment

All loaded from the **repo-root** `.env` (the existing one, not `prompt_library/.env`):

| Var | Required | What it's for |
|---|---|---|
| `OPENAI_API_KEY` | yes | GPT-4o vision for the structured prompt extractor |
| `JINA_API_KEY` | yes | jina-clip-v2 embeddings (text and image, same space) |
| `QDRANT_URL` | yes | Qdrant Cloud cluster URL — free tier is enough to start |
| `QDRANT_API_KEY` | yes | Qdrant Cloud auth |
| `APIFY_TOKEN` | strongly recommended | Without this, only the oEmbed fallback runs — no music, no carousel detail |
| `R2_*` | yes | Same five R2 vars the Node app already uses, for mirroring CDN images |

Optional: `QDRANT_COLLECTION`, `INDEX_MAX_IMAGES_PER_POST`, `APIFY_ACTOR_ID`, `APIFY_RUN_TIMEOUT_SECS`, `JINA_BASE_URL`.

## Build the index

1. Edit `seeds.json` — add `{ "post_url": "https://www.instagram.com/p/<shortcode>/", "notes": "..." }` entries. `post_url` replaces the Phase 1 `image_url` field; old seeds with `image_url` are accepted but treated as IG post URLs.
2. From the **repo root**:
   ```bash
   source prompt_library/.venv/bin/activate
   python -m prompt_library.build_index
   ```
   Idempotent — re-running on the same `seeds.json` is a no-op. New seeds get appended without touching existing rows.

Cost per indexed post (single-image): ~$0.005 for GPT-4o vision, negligible for Jina embeddings, ~$0.0003 for the Apify call. Carousels multiply the GPT-4o + Jina cost by the number of images (capped by `INDEX_MAX_IMAGES_PER_POST`, default 5).

## Run the retrieval service

```bash
source prompt_library/.venv/bin/activate
uvicorn prompt_library.server:app --port 4001 --reload
```

## Query

```bash
# Default fused mode (text + image, equal weight)
curl 'http://localhost:4001/inspire?prompt=cozy+autumn+european+travel&k=3' | jq

# Text-only ranking (just the synthesized prompt + caption corpus)
curl 'http://localhost:4001/inspire?prompt=...&mode=text' | jq

# Visual-only ranking (text query scored against image-side CLIP vectors)
curl 'http://localhost:4001/inspire?prompt=...&mode=image' | jq

# Bias toward visual signal
curl 'http://localhost:4001/inspire?prompt=...&mode=fused&image_weight=0.8' | jq

# Restrict to posts where we captured music metadata
curl 'http://localhost:4001/inspire?prompt=...&has_music=true' | jq

# Stats + readiness
curl 'http://localhost:4001/inspire/stats' | jq
curl 'http://localhost:4001/ready' | jq
```

## Files

| File | What |
|---|---|
| `seeds.json` | Manually curated IG post URLs |
| `config.py` | Env-driven service clients (OpenAI, Jina, Apify, Qdrant, R2) |
| `ig_fetch.py` | Apify primary + oEmbed fallback, normalized post payload |
| `media_mirror.py` | Download IG CDN images, upload to R2 under `prompt_library/<shortcode>/<idx>.jpg` |
| `extract.py` | GPT-4o vision → structured prompt, biased by caption + music |
| `embed.py` | jina-clip-v2 text and image embeddings (1024-dim shared space) |
| `store.py` | Qdrant wrapper: dual named-vector collection + payload filtering |
| `build_index.py` | CLI: idempotent indexer keyed on (shortcode, media_index) |
| `retrieve.py` | `retrieve_similar(query, k, mode, image_weight, has_music)` |
| `server.py` | FastAPI app on port 4001 |

## What changed from Phase 1

- Input is now IG post URLs, not raw image URLs. The seed schema field is `post_url`.
- Caption, hashtags, and music are fetched, persisted, and folded into the text-side embedding.
- Images live in R2 (durable) instead of being referenced via expiring IG CDN URLs.
- Embeddings are `jina-clip-v2` (1024-dim multimodal) instead of `text-embedding-3-small` (1536-dim text-only).
- Storage is Qdrant, not `index.json`. Concurrency, atomic writes, and the file-locking machinery are gone — Qdrant handles them.
- Retrieval supports `mode=text|image|fused` and `has_music` filtering.

The Phase 1 quarantine semantics carry over: search is always filtered to the current `embedding_model`, so a mid-migration collection still serves correct rankings from the new rows.
