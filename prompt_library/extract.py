"""VLM-based prompt extraction. Given an image URL, returns a structured + natural-language prompt suitable for FLUX / SDXL."""

import json
from openai import OpenAI

from .config import get_openai_client

EXTRACTION_SYSTEM = """You are a senior prompt engineer for FLUX / SDXL-class text-to-image models. Given an image, extract a faithful, regeneratable prompt.

Return JSON with these fields:
- scene: location/setting
- subject: who/what is in the foreground
- composition: framing, angle, position of subject
- lighting: light source, direction, quality, time of day
- style: photographic style or art reference (e.g., "editorial fashion", "35mm film", "natural travel photography")
- palette: dominant colors as comma-separated list
- mood: emotional tone
- camera: lens/depth-of-field/grain notes if visible
- prompt_text: a single natural-language paragraph (~50-80 words) that synthesizes all of the above into a feed-ready FLUX prompt. This is the field used downstream — make it production-quality.

Be specific. Avoid generic phrases like "high quality" or "8k". Describe what's actually visible."""


def extract_from_image(image_url: str) -> dict:
    client: OpenAI = get_openai_client()
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Extract a regeneratable prompt for this image."},
                    {"type": "image_url", "image_url": {"url": image_url, "detail": "high"}},
                ],
            },
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)
