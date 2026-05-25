"""CLI: read seeds.json, extract+embed any new entries, write index.json.

Idempotent — re-run after adding new seeds to incrementally extend the index.

Usage (from repo root):
    python -m prompt_library.build_index
"""

import json
import time
from datetime import datetime, timezone

from .config import SEEDS_PATH, INDEX_PATH
from .extract import extract_from_image
from .embed import embed


def load_json(path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text())


def main():
    seeds = load_json(SEEDS_PATH, [])
    index = load_json(INDEX_PATH, [])
    indexed_urls = {e["image_url"] for e in index}

    new_seeds = [s for s in seeds if s.get("image_url") and s["image_url"] not in indexed_urls]
    if not new_seeds:
        print(f"Nothing to do — index has {len(index)} entries, seeds.json has no new URLs.")
        return

    print(f"Indexing {len(new_seeds)} new entries (skipping {len(index)} already indexed)...")

    for seed in new_seeds:
        t0 = time.time()
        url = seed["image_url"]
        try:
            print(f"  → {url[:80]}...")
            structured = extract_from_image(url)
            if not structured.get("prompt_text"):
                raise RuntimeError("extractor returned no prompt_text")
            vector = embed(structured["prompt_text"])
            index.append({
                "image_url": url,
                "notes": seed.get("notes"),
                "structured": structured,
                "prompt_text": structured["prompt_text"],
                "embedding": vector,
                "indexed_at": datetime.now(timezone.utc).isoformat(),
            })
            # Persist after each entry so a crash doesn't lose progress.
            INDEX_PATH.write_text(json.dumps(index, indent=2))
            print(f"    ok ({int((time.time() - t0) * 1000)}ms)")
        except Exception as err:
            print(f"    failed: {err}")

    print(f"Done. Index now contains {len(index)} entries.")


if __name__ == "__main__":
    main()
