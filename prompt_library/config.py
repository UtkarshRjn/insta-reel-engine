"""Shared config: paths, OpenAI client (loads the repo-root .env)."""

import os
from pathlib import Path
from openai import OpenAI
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent

# Load .env from the repo root so we reuse OPENAI_API_KEY already configured for the Node server.
load_dotenv(REPO_ROOT / ".env")

SEEDS_PATH = HERE / "seeds.json"
INDEX_PATH = HERE / "index.json"

_client: OpenAI | None = None


def get_openai_client() -> OpenAI:
    global _client
    if _client is None:
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY not found in repo-root .env")
        _client = OpenAI(api_key=api_key)
    return _client
