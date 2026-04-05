import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import axios from 'axios';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const XAI_VIDEO_URL = 'https://api.x.ai/v1/videos/generations';
const XAI_IMAGE_URL = 'https://api.x.ai/v1/images/generations';

/**
 * Generate video using Grok (xAI Aurora)
 * @param {string} prompt - Video prompt describing visuals + audio
 * @param {object} options - Generation options
 */
export async function generateVideo(prompt, options = {}) {
  const {
    duration = 10,
    aspectRatio = '9:16'
  } = options;

  // Grok supports 1-15 seconds
  const validDuration = Math.min(Math.max(duration, 1), 15);

  console.log(`Generating ${validDuration}s video with Grok (xAI Aurora)...`);

  const response = await axios.post(
    XAI_VIDEO_URL,
    {
      model: 'grok-imagine-video',
      prompt,
      duration: validDuration,
      aspect_ratio: aspectRatio
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const requestId = response.data.id || response.data.request_id;
  console.log(`Request submitted: ${requestId}`);

  const result = await pollForCompletion(requestId);
  return result;
}

/**
 * Generate video with combined visual + audio prompt
 * Mirrors the old Kling interface for compatibility
 */
export async function generateVideoWithAudio(prompt, audioPrompt, options = {}) {
  const fullPrompt = audioPrompt
    ? `${prompt}. Voiceover narration: "${audioPrompt}"`
    : prompt;

  return generateVideo(fullPrompt, options);
}

/**
 * Poll xAI API for video generation completion
 */
async function pollForCompletion(requestId, maxAttempts = 180) {
  const statusUrl = `https://api.x.ai/v1/videos/${requestId}`;

  for (let i = 0; i < maxAttempts; i++) {
    const response = await axios.get(statusUrl, {
      headers: {
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`
      }
    });

    const { status } = response.data;
    console.log(`Poll ${i + 1}: ${status}`);

    if (status === 'done' || status === 'completed') {
      const videoUrl = response.data.video_url || response.data.url ||
        response.data.output?.video_url || response.data.result?.url;

      if (!videoUrl) {
        throw new Error('Video generation completed but no URL found in response');
      }

      return {
        videoUrl,
        duration: response.data.duration || null,
        requestId
      };
    }

    if (status === 'failed' || status === 'error') {
      throw new Error(`Video generation failed: ${response.data.error || 'Unknown error'}`);
    }

    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('Video generation timed out');
}

/**
 * Generate image using Grok Imagine
 * @param {string} prompt - Image prompt
 * @param {object} options - Generation options
 */
export async function generateImage(prompt, options = {}) {
  const {
    n = 1,
    aspectRatio = '9:16' // vertical for Instagram posts
  } = options;

  console.log('Generating image with Grok Imagine...');

  const response = await axios.post(
    XAI_IMAGE_URL,
    {
      model: 'grok-2-image',
      prompt,
      n,
      response_format: 'url'
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const imageUrl = response.data.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error('Image generation completed but no URL found in response');
  }

  console.log('Image generated successfully.');
  return { imageUrl };
}

/**
 * Cost estimation placeholder for Grok video generation
 */
export function estimateCost(durationSeconds) {
  const perSecond = 0.10;
  const total = durationSeconds * perSecond;
  return {
    perSecond,
    total,
    formatted: `$${total.toFixed(2)}`
  };
}
