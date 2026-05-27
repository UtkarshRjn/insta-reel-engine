"""VLM-based prompt extraction.

Given an image URL (and optional post-level context like caption + music),
return a structured + natural-language prompt suitable for FLUX / SDXL.

`post_context` is what makes Phase 2 different from Phase 1: when we know the
post's caption and music, GPT-4o can fold that signal into the synthesized
`prompt_text` so retrieval matches on the *intent* of the original post, not
just what the pixels literally show.
"""

from __future__ import annotations

import json

from openai import OpenAI

from .config import get_openai_client


EXTRACTION_SYSTEM = """You are a senior prompt engineer for FLUX / SDXL-class text-to-image models. Given an image (and optionally the caption + music of the post it came from), extract a faithful, regeneratable prompt.

Return JSON with these fields:
- scene: location/setting
- subject: who/what is in the foreground
- composition: framing, angle, position of subject
- lighting: light source, direction, quality, time of day
- style: photographic style or art reference (e.g., "editorial fashion", "35mm film", "natural travel photography")
- palette: dominant colors as comma-separated list
- mood: emotional tone (let the caption/music inform this, not just the pixels)
- camera: lens/depth-of-field/grain notes if visible
- prompt_text: a single natural-language paragraph (~50-80 words) that synthesizes all of the above into a feed-ready FLUX prompt. This is the field used downstream — make it production-quality.

Be specific. Avoid generic phrases like "high quality" or "8k". Describe what's actually visible. If a caption is provided, use it to disambiguate intent and tone — but don't quote it verbatim; the prompt should still work as a standalone image-generation prompt."""


def _format_context(post_context: dict | None) -> str:
    if not post_context:
        return "Extract a regeneratable prompt for this image."
    bits = ["Extract a regeneratable prompt for this image."]
    caption = (post_context.get("caption") or "").strip()
    if caption:
        # Truncate aggressively — captions can be huge and GPT-4o is paying by token.
        bits.append(f"Post caption: {caption[:600]}")
    music = post_context.get("music") or {}
    if music.get("title") or music.get("artist"):
        bits.append(f"Audio: {music.get('title') or '?'} — {music.get('artist') or '?'}")
    hashtags = post_context.get("hashtags") or []
    if hashtags:
        bits.append(f"Hashtags: {', '.join('#' + h for h in hashtags[:12])}")
    return "\n".join(bits)


def extract_from_image(image_url: str, post_context: dict | None = None) -> dict:
    client: OpenAI = get_openai_client()
    user_text = _format_context(post_context)
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": user_text},
                    {"type": "image_url", "image_url": {"url": image_url, "detail": "high"}},
                ],
            },
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)
