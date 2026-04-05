import ffmpeg from 'fluent-ffmpeg';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, '../uploads');

export async function combineAudioVideo(videoPath, audioPath) {
  if (!existsSync(UPLOADS_DIR)) {
    await mkdir(UPLOADS_DIR, { recursive: true });
  }

  const outputFilename = `reel_${Date.now()}.mp4`;
  const outputPath = join(UPLOADS_DIR, outputFilename);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v copy',           // Copy video codec
        '-c:a aac',            // AAC audio codec
        '-map 0:v:0',          // Use video from first input
        '-map 1:a:0',          // Use audio from second input
        '-shortest'            // Cut to shortest stream
      ])
      .output(outputPath)
      .on('end', () => {
        resolve({
          filename: outputFilename,
          filepath: outputPath,
          url: `/uploads/${outputFilename}`
        });
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        reject(err);
      })
      .run();
  });
}

export async function getVideoDuration(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
}

export async function resizeVideoForReels(videoPath) {
  const outputFilename = `resized_${Date.now()}.mp4`;
  const outputPath = join(UPLOADS_DIR, outputFilename);

  return new Promise((resolve, reject) => {
    ffmpeg(videoPath)
      .size('1080x1920')       // 9:16 aspect ratio for Reels
      .autopad('black')
      .outputOptions([
        '-c:v libx264',
        '-preset fast',
        '-crf 23'
      ])
      .output(outputPath)
      .on('end', () => {
        resolve({
          filename: outputFilename,
          filepath: outputPath,
          url: `/uploads/${outputFilename}`
        });
      })
      .on('error', reject)
      .run();
  });
}
