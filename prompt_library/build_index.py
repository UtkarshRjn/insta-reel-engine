"""CLI: read seeds.json, extract+embed any new entries, write index.json.

Idempotent — re-run after adding new seeds to incrementally extend the index.

Usage (from repo root):
    python -m prompt_library.build_index

Exits non-zero if any seed failed to index, so CI/automation can detect partial runs.
Refuses to run if another build process holds the exclusive file lock.
"""

import fcntl
import json
import os
import sys
import tempfile
import time
from datetime import datetime, timezone

from .config import SEEDS_PATH, INDEX_PATH
from .embed import EMBEDDING_DIM, EMBEDDING_MODEL, embed
from .extract import extract_from_image

LOCK_PATH = INDEX_PATH.parent / ".build_index.lock"


def load_json(path, fallback):
    if not path.exists():
        return fallback
    return json.loads(path.read_text())


def atomic_write_json(path, data):
    """Write data to path atomically: write to a temp file in the same dir, then os.replace.

    Concurrent readers will always see either the previous full index or the new full index,
    never a partial/truncated file. os.replace is atomic on POSIX and Windows.
    """
    fd, tmp_path = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        # Best-effort cleanup if the rename never happened.
        try:
            os.unlink(tmp_path)
        except FileNotFoundError:
            pass
        raise


def acquire_build_lock():
    """Acquire an exclusive non-blocking file lock so concurrent builds can't race.

    Returns the held file handle; caller is responsible for keeping it open until done.
    Raises RuntimeError if another process is already holding the lock.
    """
    lock_fp = open(LOCK_PATH, "w")
    try:
        fcntl.flock(lock_fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock_fp.close()
        raise RuntimeError(
            f"Another build_index process is already running (holds {LOCK_PATH}). "
            "Wait for it to finish, or remove the lock file if you're sure no build is active."
        )
    return lock_fp


def main():
    try:
        lock_fp = acquire_build_lock()
    except RuntimeError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2

    try:
        seeds = load_json(SEEDS_PATH, [])
        index = load_json(INDEX_PATH, [])
        indexed_urls = {e["image_url"] for e in index}

        # Pre-filter: skip blanks, skip URLs already in the prior index, and de-dupe within
        # seeds.json itself (an earlier bug: same URL appearing twice was indexed twice).
        new_seeds = []
        seen_this_run = set()
        for s in seeds:
            url = s.get("image_url")
            if not url or url in indexed_urls or url in seen_this_run:
                continue
            seen_this_run.add(url)
            new_seeds.append(s)

        if not new_seeds:
            print(f"Nothing to do — index has {len(index)} entries, seeds.json has no new URLs.")
            return 0

        print(f"Indexing {len(new_seeds)} new entries (skipping {len(index)} already indexed)...")

        failures: list[tuple[str, str]] = []

        for seed in new_seeds:
            t0 = time.time()
            url = seed["image_url"]
            try:
                print(f"  → {url[:80]}...")
                structured = extract_from_image(url)
                if not structured.get("prompt_text"):
                    raise RuntimeError("extractor returned no prompt_text")
                vector = embed(structured["prompt_text"])
                if len(vector) != EMBEDDING_DIM:
                    raise RuntimeError(
                        f"embedding length {len(vector)} != expected {EMBEDDING_DIM}"
                    )
                index.append({
                    "image_url": url,
                    "notes": seed.get("notes"),
                    "structured": structured,
                    "prompt_text": structured["prompt_text"],
                    "embedding": vector,
                    "embedding_model": EMBEDDING_MODEL,
                    "embedding_dim": EMBEDDING_DIM,
                    "indexed_at": datetime.now(timezone.utc).isoformat(),
                })
                indexed_urls.add(url)
                # Persist atomically after each entry so a crash doesn't lose progress AND
                # the retrieval service never observes a half-written file.
                atomic_write_json(INDEX_PATH, index)
                print(f"    ok ({int((time.time() - t0) * 1000)}ms)")
            except Exception as err:
                print(f"    failed: {err}")
                failures.append((url, str(err)))

        print(f"Done. Index now contains {len(index)} entries.")
        if failures:
            print(f"\n{len(failures)} seed(s) failed:")
            for url, msg in failures:
                print(f"  - {url[:80]}: {msg}")
            return 1
        return 0
    finally:
        # Releasing the lock by closing the fd is implicit on Linux/macOS, but be explicit.
        try:
            fcntl.flock(lock_fp.fileno(), fcntl.LOCK_UN)
        except Exception:
            pass
        lock_fp.close()


if __name__ == "__main__":
    sys.exit(main())
