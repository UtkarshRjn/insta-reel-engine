import cron from 'node-cron';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getNextPendingIdea, updateIdeaStatus, getToken } from './db.js';
import { generateReelContent, generateImageCaption } from './services/openai.js';
import { generateVideoWithAudio, generateImage } from './services/grok.js';
import { uploadVideo, uploadImage } from './services/storage.js';
import { postReel, postImage, refreshLongLivedToken } from './services/instagram.js';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') });

/**
 * Process the next pending idea in the queue
 */
async function processNextIdea() {
  const idea = getNextPendingIdea();

  if (!idea) {
    console.log('[Scheduler] No pending ideas for today. Skipping.');
    return;
  }

  console.log(`[Scheduler] Processing idea #${idea.id}: "${idea.prompt.substring(0, 50)}..."`);
  updateIdeaStatus(idea.id, 'processing');

  const token = getToken();
  if (!token || !token.access_token) {
    updateIdeaStatus(idea.id, 'failed', { error: 'No Instagram auth token found. Please log in first.' });
    console.error('[Scheduler] No Instagram auth token. Aborting.');
    return;
  }

  // Check token expiry
  if (token.expires_at && Date.now() > token.expires_at) {
    updateIdeaStatus(idea.id, 'failed', { error: 'Instagram token expired. Please re-authenticate.' });
    console.error('[Scheduler] Instagram token expired. Aborting.');
    return;
  }

  let retries = 3;
  let lastError;

  while (retries > 0) {
    try {
      const accessToken = token.page_access_token || token.access_token;
      let publicUrl, caption, content, result;

      if (idea.media_type === 'image') {
        // Image pipeline
        console.log('[Scheduler] Step 1: Generating image caption...');
        content = await generateImageCaption(idea.prompt);

        console.log('[Scheduler] Step 2: Generating image with Grok Imagine...');
        const image = await generateImage(content.imagePrompt);

        console.log('[Scheduler] Step 3: Uploading image to R2...');
        publicUrl = await uploadImage(image.imageUrl);

        caption = `${content.caption}\n\n${content.hashtags.map(h => `#${h}`).join(' ')}`;

        console.log('[Scheduler] Step 4: Posting image to Instagram...');
        result = await postImage(accessToken, token.instagram_account_id, publicUrl, caption);
      } else {
        // Video pipeline (default)
        console.log('[Scheduler] Step 1: Generating script...');
        content = await generateReelContent(idea.prompt);

        console.log('[Scheduler] Step 2: Generating video with Grok...');
        const video = await generateVideoWithAudio(content.videoPrompt, content.script, {
          duration: 10,
          aspectRatio: '9:16'
        });

        console.log('[Scheduler] Step 3: Uploading video to R2...');
        publicUrl = await uploadVideo(video.videoUrl);

        caption = `${content.caption}\n\n${content.hashtags.map(h => `#${h}`).join(' ')}`;

        console.log('[Scheduler] Step 4: Posting reel to Instagram...');
        result = await postReel(accessToken, token.instagram_account_id, publicUrl, caption);
      }

      // Mark completed
      updateIdeaStatus(idea.id, 'completed', {
        videoUrl: publicUrl,
        caption,
        script: JSON.stringify(content),
        instagramMediaId: result.id
      });

      console.log(`[Scheduler] Successfully posted idea #${idea.id} to Instagram (media ID: ${result.id})`);
      return;

    } catch (error) {
      lastError = error;
      retries--;
      console.error(`[Scheduler] Error processing idea #${idea.id} (${retries} retries left):`, error.message);

      if (retries > 0) {
        // Exponential backoff: 30s, 60s
        const delay = (3 - retries) * 30000;
        console.log(`[Scheduler] Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted
  updateIdeaStatus(idea.id, 'failed', { error: lastError?.message || 'Unknown error after 3 retries' });
  console.error(`[Scheduler] Failed to process idea #${idea.id} after 3 attempts.`);
}

// Parse DAILY_POST_TIME (HH:MM format) into cron expression
function getCronExpression() {
  const time = process.env.DAILY_POST_TIME || '09:00';
  const [hours, minutes] = time.split(':').map(Number);
  return `${minutes} ${hours} * * *`;
}

// Schedule daily posting
const cronExpression = getCronExpression();
console.log(`[Scheduler] Daily post scheduled at ${process.env.DAILY_POST_TIME || '09:00'} (cron: ${cronExpression})`);

cron.schedule(cronExpression, () => {
  console.log(`[Scheduler] Triggered at ${new Date().toISOString()}`);
  processNextIdea().catch(err => {
    console.error('[Scheduler] Unhandled error:', err);
  });
});

// Weekly token refresh (every Sunday at 3 AM)
cron.schedule('0 3 * * 0', async () => {
  console.log('[Scheduler] Weekly token refresh...');
  try {
    const token = getToken();
    if (token && token.access_token) {
      await refreshLongLivedToken(token.access_token);
      console.log('[Scheduler] Token refreshed successfully.');
    }
  } catch (err) {
    console.error('[Scheduler] Token refresh failed:', err.message);
  }
});

// Export for manual triggering via API
export { processNextIdea };
