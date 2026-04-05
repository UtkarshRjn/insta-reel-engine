import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import axios from 'axios';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env') });

const UPLOADS_DIR = join(__dirname, '../uploads');
const FAL_API_URL = 'https://queue.fal.run/fal-ai/kling-video/v2.6/pro/text-to-video';

/**
 * Generate video with native audio using Kling 2.6 via fal.ai
 * @param {string} prompt - Video prompt describing visuals
 * @param {string} audioPrompt - Audio/dialogue to include (will be merged with prompt)
 * @param {object} options - Generation options
 */
export async function generateVideoWithAudio(prompt, audioPrompt, options = {}) {
  const {
    duration = 10, // 5 or 10 seconds
    aspectRatio = '9:16', // vertical for reels
    generateAudio = true
  } = options;

  // Validate duration (Kling 2.6 supports 5 or 10 seconds)
  const validDuration = duration <= 5 ? 5 : 10;

  // Combine video prompt with audio/voiceover instructions
  // Kling 2.6 uses prompt to generate both visuals and audio
  const fullPrompt = audioPrompt
    ? `${prompt}. Voiceover narration: "${audioPrompt}"`
    : prompt;

  console.log(`Generating ${validDuration}s video with Kling 2.6...`);
  console.log(`Audio enabled: ${generateAudio}`);

  // Submit generation request
  const submitResponse = await axios.post(
    FAL_API_URL,
    {
      prompt: fullPrompt,
      duration: String(validDuration),
      aspect_ratio: aspectRatio,
      generate_audio: generateAudio
    },
    {
      headers: {
        'Authorization': `Key ${process.env.FAL_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  const requestId = submitResponse.data.request_id;
  console.log(`Request submitted: ${requestId}`);

  // Poll for completion
  const result = await pollForCompletion(requestId);

  // Download the video
  const videoUrl = result.video.url;
  const videoResponse = await axios.get(videoUrl, { responseType: 'arraybuffer' });

  // Ensure uploads directory exists
  if (!existsSync(UPLOADS_DIR)) {
    await mkdir(UPLOADS_DIR, { recursive: true });
  }

  const filename = `reel_${Date.now()}.mp4`;
  const filepath = join(UPLOADS_DIR, filename);
  await writeFile(filepath, videoResponse.data);

  return {
    filename,
    filepath,
    url: `/uploads/${filename}`,
    duration: validDuration,
    hasAudio: generateAudio,
    cost: estimateCost(validDuration, generateAudio)
  };
}

/**
 * Generate longer video by chaining multiple Kling generations
 * For reels > 10 seconds
 */
export async function generateLongVideo(prompt, audioPrompt, options = {}) {
  const {
    targetDuration = 15,
    aspectRatio = '9:16'
  } = options;

  // Calculate clips needed
  const clipDuration = 10;
  const numClips = Math.ceil(targetDuration / clipDuration);

  console.log(`Generating ${targetDuration}s video using ${numClips} x ${clipDuration}s clips`);

  const clips = [];

  for (let i = 0; i < numClips; i++) {
    const isLastClip = i === numClips - 1;
    const remainingDuration = targetDuration - (i * clipDuration);
    const duration = isLastClip && remainingDuration <= 5 ? 5 : 10;

    // Split audio prompt across clips (rough split by sentences)
    const audioSegment = audioPrompt ? splitAudioPrompt(audioPrompt, i, numClips) : null;

    console.log(`Generating clip ${i + 1}/${numClips} (${duration}s)...`);

    const clip = await generateVideoWithAudio(prompt, audioSegment, {
      duration,
      aspectRatio,
      generateAudio: true
    });

    clips.push(clip);
  }

  // If single clip, return it directly
  if (clips.length === 1) {
    return clips[0];
  }

  // Combine clips using ffmpeg
  const finalVideo = await combineClips(clips);
  return finalVideo;
}

/**
 * Split audio prompt into segments for multi-clip videos
 */
function splitAudioPrompt(audioPrompt, clipIndex, totalClips) {
  const sentences = audioPrompt.match(/[^.!?]+[.!?]+/g) || [audioPrompt];
  const sentencesPerClip = Math.ceil(sentences.length / totalClips);
  const start = clipIndex * sentencesPerClip;
  const end = Math.min(start + sentencesPerClip, sentences.length);
  return sentences.slice(start, end).join(' ').trim();
}

/**
 * Combine multiple video clips using ffmpeg
 */
async function combineClips(clips) {
  const ffmpeg = (await import('fluent-ffmpeg')).default;
  const { unlink } = await import('fs/promises');

  const listContent = clips.map(c => `file '${c.filepath}'`).join('\n');
  const listPath = join(UPLOADS_DIR, `concat_${Date.now()}.txt`);
  await writeFile(listPath, listContent);

  const outputFilename = `reel_${Date.now()}.mp4`;
  const outputPath = join(UPLOADS_DIR, outputFilename);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy'])
      .output(outputPath)
      .on('end', async () => {
        // Clean up
        await unlink(listPath).catch(() => {});
        for (const clip of clips) {
          await unlink(clip.filepath).catch(() => {});
        }

        resolve({
          filename: outputFilename,
          filepath: outputPath,
          url: `/uploads/${outputFilename}`,
          duration: clips.reduce((sum, c) => sum + c.duration, 0),
          hasAudio: true,
          clips: clips.length,
          cost: clips.reduce((sum, c) => ({
            perSecond: 0.14,
            total: sum.total + c.cost.total,
            formatted: `$${(sum.total + c.cost.total).toFixed(2)}`
          }), { total: 0 })
        });
      })
      .on('error', async (err) => {
        await unlink(listPath).catch(() => {});
        reject(err);
      })
      .run();
  });
}

/**
 * Poll fal.ai for task completion
 */
async function pollForCompletion(requestId, maxAttempts = 120) {
  const statusUrl = `https://queue.fal.run/fal-ai/kling-video/v2.6/pro/text-to-video/requests/${requestId}/status`;
  const resultUrl = `https://queue.fal.run/fal-ai/kling-video/v2.6/pro/text-to-video/requests/${requestId}`;

  for (let i = 0; i < maxAttempts; i++) {
    const response = await axios.get(statusUrl, {
      headers: {
        'Authorization': `Key ${process.env.FAL_KEY}`
      }
    });

    const { status } = response.data;
    console.log(`Poll ${i + 1}: ${status}`);

    if (status === 'COMPLETED') {
      // Fetch the result
      const resultResponse = await axios.get(resultUrl, {
        headers: {
          'Authorization': `Key ${process.env.FAL_KEY}`
        }
      });
      return resultResponse.data;
    }

    if (status === 'FAILED') {
      throw new Error(`Video generation failed: ${response.data.error || 'Unknown error'}`);
    }

    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('Video generation timed out');
}

/**
 * Cost estimation for Kling 2.6
 */
export function estimateCost(durationSeconds, withAudio = true) {
  const perSecond = withAudio ? 0.14 : 0.07;
  const total = durationSeconds * perSecond;
  return {
    perSecond,
    total,
    formatted: `$${total.toFixed(2)}`
  };
}
