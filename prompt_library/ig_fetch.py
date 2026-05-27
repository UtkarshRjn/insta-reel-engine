"""Resolve an Instagram post URL into a normalized payload.

Primary: Apify "Instagram Post Scraper" actor — full payload including music.
Fallback: Facebook oEmbed — caption + thumbnail only, no music, no carousel detail.

The fallback exists so local dev without APIFY_TOKEN still produces *something*,
but production indexing should always run with APIFY_TOKEN set.
"""

import re
import time

import httpx

from .config import (
    APIFY_ACTOR_ID,
    APIFY_BASE_URL,
    APIFY_RUN_TIMEOUT_SECS,
    get_apify_token,
)


SHORTCODE_RE = re.compile(r"instagram\.com/(?:p|reel|tv)/([A-Za-z0-9_-]+)")


class IGFetchError(RuntimeError):
    pass


def extract_shortcode(post_url: str) -> str:
    m = SHORTCODE_RE.search(post_url)
    if not m:
        raise IGFetchError(f"Could not extract shortcode from {post_url!r}")
    return m.group(1)


def _canonical_post_url(shortcode: str) -> str:
    return f"https://www.instagram.com/p/{shortcode}/"


def fetch_post(post_url: str) -> dict:
    """Return a normalized post payload.

    {
        "shortcode": str,
        "post_url": str,                # canonicalized
        "media": [{"url": str, "kind": "image"|"video"}, ...],
        "caption": str,
        "hashtags": [str],
        "music": {"title": str, "artist": str} | None,
        "like_count": int | None,
        "comment_count": int | None,
        "owner_username": str | None,
        "posted_at": str | None,        # ISO-8601 if available
        "source": "apify" | "oembed",
    }
    """
    shortcode = extract_shortcode(post_url)
    canonical = _canonical_post_url(shortcode)

    token = get_apify_token()
    if token:
        try:
            return _fetch_via_apify(canonical, shortcode, token)
        except Exception as err:
            # Fall through to oEmbed rather than failing the whole run, but log.
            print(f"[ig_fetch] Apify failed for {shortcode}: {err}. Falling back to oEmbed.")

    return _fetch_via_oembed(canonical, shortcode)


# ---- Apify ----

def _fetch_via_apify(post_url: str, shortcode: str, token: str) -> dict:
    """Run the Apify Instagram Post Scraper synchronously and return the first item."""
    run_endpoint = f"{APIFY_BASE_URL}/acts/{APIFY_ACTOR_ID.replace('/', '~')}/run-sync-get-dataset-items"
    payload = {
        "directUrls": [post_url],
        "resultsLimit": 1,
        "addParentData": False,
    }

    with httpx.Client(timeout=APIFY_RUN_TIMEOUT_SECS) as client:
        resp = client.post(
            run_endpoint,
            params={"token": token, "timeout": APIFY_RUN_TIMEOUT_SECS},
            json=payload,
        )

    if resp.status_code >= 400:
        raise IGFetchError(f"Apify HTTP {resp.status_code}: {resp.text[:300]}")

    items = resp.json()
    if not items:
        raise IGFetchError(f"Apify returned no items for {shortcode}")

    return _normalize_apify_item(items[0], shortcode, post_url)


def _normalize_apify_item(item: dict, shortcode: str, post_url: str) -> dict:
    # Apify item shapes vary slightly between scraper versions; pick fields defensively.
    caption_raw = item.get("caption") or item.get("description") or ""
    hashtags = item.get("hashtags") or _extract_hashtags(caption_raw)

    media = []
    # Carousel: `images` (list of URLs) or `childPosts` (list of dicts)
    if isinstance(item.get("images"), list) and item["images"]:
        for url in item["images"]:
            media.append({"url": url, "kind": "image"})
    elif isinstance(item.get("childPosts"), list) and item["childPosts"]:
        for child in item["childPosts"]:
            kind = "video" if child.get("videoUrl") else "image"
            url = child.get("videoUrl") if kind == "video" else (
                child.get("displayUrl") or child.get("imageUrl")
            )
            if url:
                media.append({"url": url, "kind": kind})
    elif item.get("displayUrl"):
        kind = "video" if item.get("type") == "Video" or item.get("videoUrl") else "image"
        url = item["videoUrl"] if kind == "video" and item.get("videoUrl") else item["displayUrl"]
        media.append({"url": url, "kind": kind})

    music = None
    music_info = item.get("musicInfo") or item.get("music_info") or {}
    if music_info:
        title = music_info.get("song_name") or music_info.get("title")
        artist = music_info.get("artist_name") or music_info.get("artist")
        if title or artist:
            music = {"title": title, "artist": artist}

    return {
        "shortcode": shortcode,
        "post_url": post_url,
        "media": media,
        "caption": caption_raw,
        "hashtags": hashtags,
        "music": music,
        "like_count": _maybe_int(item.get("likesCount") or item.get("likes_count")),
        "comment_count": _maybe_int(item.get("commentsCount") or item.get("comments_count")),
        "owner_username": item.get("ownerUsername") or (item.get("owner") or {}).get("username"),
        "posted_at": item.get("timestamp") or item.get("taken_at_timestamp_iso"),
        "source": "apify",
    }


# ---- oEmbed fallback ----

OEMBED_URL = "https://graph.facebook.com/v18.0/instagram_oembed"


def _fetch_via_oembed(post_url: str, shortcode: str) -> dict:
    """oEmbed gives caption + thumbnail only. Used when Apify is unavailable.

    Even this needs a Facebook app access token in newer API versions, so it may
    also fail — in which case we raise with a clear message.
    """
    import os
    app_id = os.environ.get("INSTAGRAM_APP_ID")
    app_secret = os.environ.get("INSTAGRAM_APP_SECRET")
    if not (app_id and app_secret):
        raise IGFetchError(
            "No APIFY_TOKEN and no INSTAGRAM_APP_ID/INSTAGRAM_APP_SECRET for oEmbed fallback. "
            "Set APIFY_TOKEN for full extraction."
        )

    access_token = f"{app_id}|{app_secret}"
    with httpx.Client(timeout=30) as client:
        resp = client.get(OEMBED_URL, params={"url": post_url, "access_token": access_token})

    if resp.status_code >= 400:
        raise IGFetchError(f"oEmbed HTTP {resp.status_code}: {resp.text[:300]}")

    data = resp.json()
    thumbnail = data.get("thumbnail_url")
    caption = data.get("title") or ""

    return {
        "shortcode": shortcode,
        "post_url": post_url,
        "media": [{"url": thumbnail, "kind": "image"}] if thumbnail else [],
        "caption": caption,
        "hashtags": _extract_hashtags(caption),
        "music": None,
        "like_count": None,
        "comment_count": None,
        "owner_username": data.get("author_name"),
        "posted_at": None,
        "source": "oembed",
    }


# ---- helpers ----

HASHTAG_RE = re.compile(r"#(\w+)")


def _extract_hashtags(text: str) -> list[str]:
    if not text:
        return []
    return HASHTAG_RE.findall(text)


def _maybe_int(v) -> int | None:
    if v is None:
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None
