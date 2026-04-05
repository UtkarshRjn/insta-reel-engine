import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const FAL_HEADERS = {
  'Authorization': `Key ${process.env.FAL_KEY}`,
  'Content-Type': 'application/json'
};

// --- FLUX Kontext Pro (Image Generation) ---

const FLUX_API_URL = 'https://queue.fal.run/fal-ai/flux-pro/kontext';

/**
 * Generate image using FLUX Kontext Pro via fal.ai
 * Supports reference image for character consistency
 */
export async function generateFluxImage(prompt, options = {}) {
  const {
    referenceImageUrl = process.env.CHARACTER_REF_IMAGE_URL || null,
    aspectRatio = '9:16'
  } = options;

  console.log('Generating image with FLUX Kontext Pro...');

  const body = {
    prompt,
    aspect_ratio: aspectRatio,
    num_images: 1,
    output_format: 'png',
    guidance_scale: 3.5
  };

  // Add reference image for character consistency
  if (referenceImageUrl) {
    body.image_url = referenceImageUrl;
    console.log('Using character reference image for consistency.');
  }

  const submitResponse = await axios.post(FLUX_API_URL, body, {
    headers: FAL_HEADERS
  });

  const requestId = submitResponse.data.request_id;
  console.log(`FLUX request submitted: ${requestId}`);

  const result = await pollFalCompletion(
    `${FLUX_API_URL}/requests/${requestId}/status`,
    `${FLUX_API_URL}/requests/${requestId}`
  );

  const imageUrl = result.images?.[0]?.url;
  if (!imageUrl) {
    throw new Error('FLUX image generation completed but no URL found');
  }

  console.log('FLUX image generated successfully.');
  return { imageUrl };
}

// --- Kling 3.0 Pro (Video Generation) ---

const KLING_API_URL = 'https://queue.fal.run/fal-ai/kling-video/v2.6/pro/text-to-video';

/**
 * Generate video using Kling via fal.ai
 * Supports reference image for character consistency via element binding
 */
export async function generateKlingVideo(prompt, audioPrompt, options = {}) {
  const {
    duration = 10,
    aspectRatio = '9:16',
    generateAudio = true,
    referenceImageUrl = process.env.CHARACTER_REF_IMAGE_URL || null
  } = options;

  const validDuration = duration <= 5 ? 5 : 10;

  const fullPrompt = audioPrompt
    ? `${prompt}. Voiceover narration: "${audioPrompt}"`
    : prompt;

  console.log(`Generating ${validDuration}s video with Kling via fal.ai...`);

  const body = {
    prompt: fullPrompt,
    duration: String(validDuration),
    aspect_ratio: aspectRatio,
    generate_audio: generateAudio
  };

  // Add reference image for character consistency
  if (referenceImageUrl) {
    body.image_url = referenceImageUrl;
    console.log('Using character reference image for consistency.');
  }

  const submitResponse = await axios.post(KLING_API_URL, body, {
    headers: FAL_HEADERS
  });

  const requestId = submitResponse.data.request_id;
  console.log(`Kling request submitted: ${requestId}`);

  const result = await pollFalCompletion(
    `${KLING_API_URL}/requests/${requestId}/status`,
    `${KLING_API_URL}/requests/${requestId}`
  );

  const videoUrl = result.video?.url;
  if (!videoUrl) {
    throw new Error('Kling video generation completed but no URL found');
  }

  console.log('Kling video generated successfully.');
  return {
    videoUrl,
    duration: validDuration,
    requestId
  };
}

// --- Shared fal.ai polling ---

async function pollFalCompletion(statusUrl, resultUrl, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await axios.get(statusUrl, {
      headers: FAL_HEADERS
    });

    const { status } = response.data;
    console.log(`fal.ai poll ${i + 1}: ${status}`);

    if (status === 'COMPLETED') {
      const resultResponse = await axios.get(resultUrl, {
        headers: FAL_HEADERS
      });
      return resultResponse.data;
    }

    if (status === 'FAILED') {
      throw new Error(`fal.ai generation failed: ${response.data.error || 'Unknown error'}`);
    }

    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('fal.ai generation timed out');
}
