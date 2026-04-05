import axios from 'axios';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, '../uploads');

const RUNWAY_API_URL = 'https://api.runwayml.com/v1';
const API_VERSION = '2024-11-06';

// Gen-4 Turbo: 5 credits/second (most cost-effective)
// Supports 5 or 10 second clips, chain for longer videos

export async function generateVideo(prompt, options = {}) {
  const {
    targetDuration = 15, // target duration in seconds (15-30)
    aspectRatio = '9:16', // vertical for reels
    imageUrl = null // optional starting image
  } = options;

  // Calculate how many clips we need (Gen-4 Turbo max is 10s per clip)
  const clipDuration = 10; // use max duration per clip for efficiency
  const numClips = Math.ceil(targetDuration / clipDuration);

  console.log(`Generating ${targetDuration}s video using ${numClips} x ${clipDuration}s clips`);

  const clips = [];
  let lastFrameUrl = imageUrl;

  for (let i = 0; i < numClips; i++) {
    // For the last clip, calculate exact duration needed
    const remainingDuration = targetDuration - (i * clipDuration);
    const duration = Math.min(clipDuration, remainingDuration);
    // Gen-4 Turbo only supports 5 or 10 second durations
    const actualDuration = duration <= 5 ? 5 : 10;

    console.log(`Generating clip ${i + 1}/${numClips} (${actualDuration}s)...`);

    const clip = await generateClip({
      prompt,
      duration: actualDuration,
      aspectRatio,
      imageUrl: lastFrameUrl
    });

    clips.push(clip);

    // Use the generated video's last frame as starting point for next clip
    // This creates visual continuity between clips
    if (i < numClips - 1) {
      lastFrameUrl = clip.output[0]; // video URL for extension
    }
  }

  // Download and combine clips
  const finalVideo = await combineClips(clips);

  return finalVideo;
}

async function generateClip({ prompt, duration, aspectRatio, imageUrl }) {
  const payload = {
    model: 'gen4_turbo',
    promptText: prompt,
    duration,
    ratio: aspectRatio,
    watermark: false
  };

  // If we have a starting image/video, use it for continuity
  if (imageUrl) {
    payload.promptImage = imageUrl;
  }

  const createResponse = await axios.post(
    `${RUNWAY_API_URL}/v1/image_to_video`,
    payload,
    {
      headers: {
        'Authorization': `Bearer ${process.env.RUNWAY_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Runway-Version': API_VERSION
      }
    }
  );

  const taskId = createResponse.data.id;
  return await pollForCompletion(taskId);
}

async function combineClips(clips) {
  if (!existsSync(UPLOADS_DIR)) {
    await mkdir(UPLOADS_DIR, { recursive: true });
  }

  // If single clip, just download it
  if (clips.length === 1) {
    const videoResponse = await axios.get(clips[0].output[0], {
      responseType: 'arraybuffer'
    });

    const filename = `video_${Date.now()}.mp4`;
    const filepath = join(UPLOADS_DIR, filename);
    await writeFile(filepath, videoResponse.data);

    return {
      filename,
      filepath,
      url: `/uploads/${filename}`,
      duration: clips[0].duration || 10,
      clips: 1
    };
  }

  // Multiple clips - download all and combine with ffmpeg
  const clipPaths = [];

  for (let i = 0; i < clips.length; i++) {
    const videoResponse = await axios.get(clips[i].output[0], {
      responseType: 'arraybuffer'
    });

    const clipFilename = `clip_${Date.now()}_${i}.mp4`;
    const clipPath = join(UPLOADS_DIR, clipFilename);
    await writeFile(clipPath, videoResponse.data);
    clipPaths.push(clipPath);
  }

  // Combine using ffmpeg
  const outputFilename = `video_${Date.now()}.mp4`;
  const outputPath = join(UPLOADS_DIR, outputFilename);

  await combineWithFFmpeg(clipPaths, outputPath);

  // Clean up individual clips
  const { unlink } = await import('fs/promises');
  for (const clipPath of clipPaths) {
    await unlink(clipPath).catch(() => {});
  }

  return {
    filename: outputFilename,
    filepath: outputPath,
    url: `/uploads/${outputFilename}`,
    duration: clips.length * 10,
    clips: clips.length
  };
}

async function combineWithFFmpeg(inputPaths, outputPath) {
  const ffmpeg = (await import('fluent-ffmpeg')).default;

  return new Promise((resolve, reject) => {
    // Create a concat file list
    const listContent = inputPaths.map(p => `file '${p}'`).join('\n');
    const listPath = join(UPLOADS_DIR, `concat_${Date.now()}.txt`);

    import('fs/promises').then(async ({ writeFile, unlink }) => {
      await writeFile(listPath, listContent);

      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy'])
        .output(outputPath)
        .on('end', async () => {
          await unlink(listPath).catch(() => {});
          resolve();
        })
        .on('error', async (err) => {
          await unlink(listPath).catch(() => {});
          reject(err);
        })
        .run();
    });
  });
}

async function pollForCompletion(taskId, maxAttempts = 120) {
  for (let i = 0; i < maxAttempts; i++) {
    const response = await axios.get(
      `${RUNWAY_API_URL}/v1/tasks/${taskId}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.RUNWAY_API_KEY}`,
          'X-Runway-Version': API_VERSION
        }
      }
    );

    const { status, output, failure } = response.data;

    if (status === 'SUCCEEDED') {
      return response.data;
    }

    if (status === 'FAILED') {
      throw new Error(`Video generation failed: ${failure || 'Unknown error'}`);
    }

    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  throw new Error('Video generation timed out');
}

export async function getTaskStatus(taskId) {
  const response = await axios.get(
    `${RUNWAY_API_URL}/v1/tasks/${taskId}`,
    {
      headers: {
        'Authorization': `Bearer ${process.env.RUNWAY_API_KEY}`,
        'X-Runway-Version': API_VERSION
      }
    }
  );
  return response.data;
}

// Cost estimation helper
export function estimateCost(durationSeconds) {
  const creditsPerSecond = 5; // Gen-4 Turbo rate
  const costPerCredit = 0.01;
  const totalCredits = durationSeconds * creditsPerSecond;
  return {
    credits: totalCredits,
    cost: totalCredits * costPerCredit,
    formatted: `$${(totalCredits * costPerCredit).toFixed(2)}`
  };
}
