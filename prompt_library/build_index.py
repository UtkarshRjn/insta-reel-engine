"""Index Instagram posts into Qdrant.

Pipeline per seed:
    post_url -> ig_fetch.fetch_post     (Apify, oEmbed fallback)
             -> media_mirror.mirror_to_r2 (one stable URL per image)
             -> extract.extract_from_image with post_context (caption + music)
             -> embed.embed_text + embed.embed_image
             -> store.upsert_point      (Qdrant)

Idempotent by deterministic point id derived from (shortcode, media_index).
Re-running on the same seeds.json is a no-op.

Usage (from repo root):
    python -m prompt_library.build_index

Exit codes:
    0 — success
    1 — at least one seed failed to index
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone

from .config import (
    INDEX_MAX_IMAGES_PER_POST,
    SEEDS_PATH,
)
from .embed import EMBEDDING_DIM, EMBEDDING_MODEL, embed_image, embed_text
from .extract import extract_from_image
from .ig_fetch import IGFetchError, fetch_post
from .media_mirror import mirror_to_r2, stable_id_for
from .store import (
    count_current_model,
    ensure_collection,
    existing_point_ids,
    upsert_point,
)


def _load_seeds() -> list[dict]:
    if not SEEDS_PATH.exists():
        return []
    return json.loads(SEEDS_PATH.read_text())


def _seed_url(seed: dict) -> str | None:
    # Accept either `post_url` (Phase 2) or `image_url` (Phase 1 leftover).
    return seed.get("post_url") or seed.get("image_url")


def _build_text_corpus(structured: dict, post: dict) -> str:
    """The string handed to embed_text for the text-side vector.

    Including the caption + hashtags makes the text vector reflect the *intent*
    of the post, not just the synthesized visual prompt. That's what surfaces
    a "moody breakup" post when you query for it, even when pixels look pretty.
    """
    parts = [structured.get("prompt_text", "")]
    if post.get("caption"):
        parts.append(f"Caption: {post['caption']}")
    if post.get("hashtags"):
        parts.append("Tags: " + " ".join(f"#{h}" for h in post["hashtags"][:20]))
    music = post.get("music") or {}
    if music.get("title") or music.get("artist"):
        parts.append(f"Audio: {music.get('title') or '?'} - {music.get('artist') or '?'}")
    return "\n".join(p for p in parts if p)


def _build_payload(post: dict, structured: dict, media_index: int, r2_url: str) -> dict:
    music = post.get("music") or {}
    return {
        "post_url": post["post_url"],
        "shortcode": post["shortcode"],
        "media_index": media_index,
        "media_url": r2_url,
        "prompt_text": structured.get("prompt_text", ""),
        "structured": structured,
        "caption": post.get("caption") or "",
        "hashtags": post.get("hashtags") or [],
        "music_title": music.get("title"),
        "music_artist": music.get("artist"),
        "has_music": bool(music.get("title") or music.get("artist")),
        "like_count": post.get("like_count"),
        "comment_count": post.get("comment_count"),
        "owner_username": post.get("owner_username"),
        "posted_at": post.get("posted_at"),
        "source": post.get("source"),
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dim": EMBEDDING_DIM,
        "indexed_at": datetime.now(timezone.utc).isoformat(),
    }


def _index_one_post(seed: dict) -> tuple[int, int]:
    """Index every image in one post. Returns (newly_indexed, skipped)."""
    url = _seed_url(seed)
    if not url:
        raise ValueError("seed has no post_url")

    post = fetch_post(url)
    images = [m for m in post["media"] if m["kind"] == "image"]
    if not images:
        raise IGFetchError(f"{post['shortcode']}: no images in post")

    images = images[:INDEX_MAX_IMAGES_PER_POST]

    # Pre-compute point ids so we can skip already-indexed slots without doing
    # any expensive work (R2 mirror, GPT-4o, Jina) on them.
    point_ids = [stable_id_for(post["shortcode"], i) for i in range(len(images))]
    already = existing_point_ids(point_ids)

    newly = 0
    skipped = 0

    for i, media in enumerate(images):
        pid = point_ids[i]
        if pid in already:
            skipped += 1
            continue

        r2_url = mirror_to_r2(media["url"], post["shortcode"], i)

        structured = extract_from_image(r2_url, post_context=post)
        if not structured.get("prompt_text"):
            raise RuntimeError(f"extractor returned no prompt_text for {post['shortcode']}#{i}")

        text_corpus = _build_text_corpus(structured, post)
        text_vec = embed_text(text_corpus)
        if len(text_vec) != EMBEDDING_DIM:
            raise RuntimeError(f"text vector len {len(text_vec)} != {EMBEDDING_DIM}")

        image_vec = embed_image(r2_url)
        if len(image_vec) != EMBEDDING_DIM:
            raise RuntimeError(f"image vector len {len(image_vec)} != {EMBEDDING_DIM}")

        payload = _build_payload(post, structured, i, r2_url)
        upsert_point(point_id=pid, text_vector=text_vec, image_vector=image_vec, payload=payload)
        newly += 1

    return newly, skipped


def main() -> int:
    seeds = _load_seeds()
    if not seeds:
        print(f"seeds.json is empty at {SEEDS_PATH}")
        return 0

    ensure_collection()
    before = count_current_model()
    print(f"Qdrant currently has {before} points stamped {EMBEDDING_MODEL}. "
          f"Processing {len(seeds)} seed(s)...")

    total_new = 0
    total_skipped = 0
    failures: list[tuple[str, str]] = []

    for seed in seeds:
        url = _seed_url(seed) or "?"
        t0 = time.time()
        try:
            print(f"  → {url[:80]}")
            new, skipped = _index_one_post(seed)
            total_new += new
            total_skipped += skipped
            dt = int((time.time() - t0) * 1000)
            print(f"    ok ({dt}ms, indexed {new}, skipped {skipped})")
        except Exception as err:
            print(f"    failed: {err}")
            failures.append((url, str(err)))

    after = count_current_model()
    print(f"\nDone. Indexed {total_new} new images, skipped {total_skipped} already-indexed. "
          f"Qdrant now has {after} points stamped {EMBEDDING_MODEL}.")

    if failures:
        print(f"\n{len(failures)} seed(s) failed:")
        for url, msg in failures:
            print(f"  - {url[:80]}: {msg}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
