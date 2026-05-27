"""Shared config: paths, env-driven service clients (loads the repo-root .env)."""

import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent

# Load .env from the repo root so we reuse the same keys the Node server uses.
load_dotenv(REPO_ROOT / ".env")

SEEDS_PATH = HERE / "seeds.json"

# Phase 1 artifact path. Kept only so the one-shot migrator can still read a
# pre-existing flat-file index. Phase 2 retrieval lives in Qdrant.
LEGACY_INDEX_PATH = HERE / "index.json"

# --- OpenAI (still used by extract.py for GPT-4o vision) ---

_openai_client: OpenAI | None = None


def get_openai_client() -> OpenAI:
    global _openai_client
    if _openai_client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not found in repo-root .env")
        _openai_client = OpenAI(api_key=api_key)
    return _openai_client


# --- Jina (CLIP v2 multimodal embeddings) ---

JINA_API_KEY_ENV = "JINA_API_KEY"
JINA_BASE_URL = os.environ.get("JINA_BASE_URL", "https://api.jina.ai/v1")


def require_jina_key() -> str:
    key = os.environ.get(JINA_API_KEY_ENV)
    if not key:
        raise RuntimeError(
            "JINA_API_KEY not set. Get one at https://jina.ai/ and add it to .env."
        )
    return key


# --- Apify (Instagram post scraping) ---

APIFY_TOKEN_ENV = "APIFY_TOKEN"
# The community-maintained scraper actor. Override if you prefer a different one.
APIFY_ACTOR_ID = os.environ.get("APIFY_ACTOR_ID", "apify/instagram-post-scraper")
APIFY_BASE_URL = "https://api.apify.com/v2"


def get_apify_token() -> str | None:
    return os.environ.get(APIFY_TOKEN_ENV) or None


# --- Cloudflare R2 (media mirroring) ---

def r2_config() -> dict:
    missing = [
        k for k in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY", "R2_SECRET_KEY",
                    "R2_BUCKET_NAME", "R2_PUBLIC_URL")
        if not os.environ.get(k)
    ]
    if missing:
        raise RuntimeError(
            f"Missing R2 env vars: {', '.join(missing)}. "
            "These are required for mirroring IG CDN images to a stable URL."
        )
    return {
        "account_id": os.environ["R2_ACCOUNT_ID"],
        "access_key": os.environ["R2_ACCESS_KEY"],
        "secret_key": os.environ["R2_SECRET_KEY"],
        "bucket": os.environ["R2_BUCKET_NAME"],
        "public_url": os.environ["R2_PUBLIC_URL"].rstrip("/"),
    }


# --- Qdrant ---

QDRANT_URL_ENV = "QDRANT_URL"
QDRANT_API_KEY_ENV = "QDRANT_API_KEY"
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "prompt_library")


def qdrant_endpoint() -> tuple[str, str | None]:
    url = os.environ.get(QDRANT_URL_ENV)
    if not url:
        raise RuntimeError(
            f"{QDRANT_URL_ENV} not set. Create a free cluster at "
            "https://cloud.qdrant.io and set QDRANT_URL + QDRANT_API_KEY."
        )
    return url, os.environ.get(QDRANT_API_KEY_ENV)


# --- Build-time tunables ---

INDEX_MAX_IMAGES_PER_POST = int(os.environ.get("INDEX_MAX_IMAGES_PER_POST", "5"))
APIFY_RUN_TIMEOUT_SECS = int(os.environ.get("APIFY_RUN_TIMEOUT_SECS", "180"))
