"""Mirror Instagram CDN images to Cloudflare R2 so we have stable URLs.

IG CDN URLs are signed and expire in hours-to-days. Anything we want to keep
referencing — for re-extraction, for /inspire response payloads — has to live
on a host we control. R2 is the same bucket the Node app already uses for
generated reel images.
"""

from __future__ import annotations

import hashlib

import boto3
import httpx
from botocore.config import Config as BotoConfig

from .config import r2_config


_s3_client = None
_known_keys: set[str] = set()


def _get_s3():
    global _s3_client
    if _s3_client is None:
        cfg = r2_config()
        _s3_client = boto3.client(
            "s3",
            endpoint_url=f"https://{cfg['account_id']}.r2.cloudflarestorage.com",
            aws_access_key_id=cfg["access_key"],
            aws_secret_access_key=cfg["secret_key"],
            region_name="auto",
            config=BotoConfig(signature_version="s3v4"),
        )
    return _s3_client


def _key_for(shortcode: str, idx: int, content_type: str) -> str:
    ext = "jpg"
    if "png" in content_type:
        ext = "png"
    elif "webp" in content_type:
        ext = "webp"
    elif "mp4" in content_type or "video" in content_type:
        ext = "mp4"
    return f"prompt_library/{shortcode}/{idx}.{ext}"


def _object_exists(bucket: str, key: str) -> bool:
    if key in _known_keys:
        return True
    try:
        _get_s3().head_object(Bucket=bucket, Key=key)
        _known_keys.add(key)
        return True
    except Exception:
        return False


def mirror_to_r2(signed_cdn_url: str, shortcode: str, idx: int) -> str:
    """Download from IG CDN and upload to R2. Returns the stable public URL.

    Idempotent: if an object already exists at the destination key, the upload
    is skipped and the public URL is returned directly. We don't re-verify the
    bytes match — IG CDN URLs are signed and we trust that `(shortcode, idx)`
    uniquely identifies a media slot.
    """
    cfg = r2_config()
    bucket = cfg["bucket"]
    public_base = cfg["public_url"]

    # Probe content type with a HEAD first so we choose the right extension.
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        head = client.head(signed_cdn_url)
        # Some CDNs reject HEAD; fall back to a GET stream in that case.
        if head.status_code >= 400:
            resp = client.get(signed_cdn_url)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "image/jpeg").split(";")[0].strip()
            body = resp.content
        else:
            content_type = head.headers.get("content-type", "image/jpeg").split(";")[0].strip()
            key = _key_for(shortcode, idx, content_type)
            if _object_exists(bucket, key):
                return f"{public_base}/{key}"
            resp = client.get(signed_cdn_url)
            resp.raise_for_status()
            body = resp.content

    key = _key_for(shortcode, idx, content_type)
    if _object_exists(bucket, key):
        return f"{public_base}/{key}"

    _get_s3().put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType=content_type,
        # Small hint so a future viewer-of-the-bucket can tell where the file came from.
        Metadata={"source": "instagram", "shortcode": shortcode, "idx": str(idx)},
    )
    _known_keys.add(key)
    return f"{public_base}/{key}"


def stable_id_for(shortcode: str, idx: int) -> str:
    """Deterministic UUID-ish point id for Qdrant, derived from (shortcode, idx).

    Re-running build_index on the same seed re-derives the same id, which makes
    upserts naturally idempotent without needing a separate dedupe pass.
    """
    digest = hashlib.sha1(f"{shortcode}::{idx}".encode()).hexdigest()
    # Format as a UUID-like string Qdrant accepts.
    return f"{digest[0:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:32]}"
