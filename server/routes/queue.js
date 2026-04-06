import { Router } from 'express';
import { addIdea, getQueue, deleteIdea, retryIdea, getNextPendingIdea, getIdeaById, updatePreviewStatus, updateIdeaStatus, getToken } from '../db.js';

const router = Router();

// Add a new idea to the queue
router.post('/ideas', (req, res) => {
  try {
    const { prompt, scheduledDate, mediaType, model, imageCount } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const validType = mediaType === 'image' ? 'image' : 'video';
    const validModel = ['grok', 'flux', 'kling'].includes(model) ? model : 'grok';
    const idea = addIdea(prompt.trim(), scheduledDate || null, validType, validModel, imageCount);
    res.status(201).json(idea);
  } catch (error) {
    console.error('Add idea error:', error);
    res.status(500).json({ error: error.message });
  }
});

// List all ideas (optional status filter)
router.get('/ideas', (req, res) => {
  try {
    const { status } = req.query;
    const ideas = getQueue(status || null);
    res.json(ideas);
  } catch (error) {
    console.error('Get queue error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a pending idea
router.delete('/ideas/:id', (req, res) => {
  try {
    const deleted = deleteIdea(Number(req.params.id));
    if (!deleted) {
      return res.status(404).json({ error: 'Idea not found or not in pending status' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete idea error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Retry a failed idea
router.post('/ideas/:id/retry', (req, res) => {
  try {
    const retried = retryIdea(Number(req.params.id));
    if (!retried) {
      return res.status(404).json({ error: 'Idea not found or not in failed status' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Retry idea error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate preview images (without posting)
router.post('/ideas/:id/generate-preview', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const idea = getIdeaById(id);

    if (!idea) {
      return res.status(404).json({ error: 'Idea not found' });
    }
    if (idea.status !== 'pending') {
      return res.status(400).json({ error: 'Idea is not in pending status' });
    }

    // Mark as generating
    updatePreviewStatus(id, 'generating');

    // Run async, respond immediately
    generatePreviewImages(idea).catch(err => {
      console.error(`[Preview] Error for #${id}:`, err.message);
      updatePreviewStatus(id, 'failed', { error: err.message });
    });

    res.json({ message: `Generating preview for idea #${id}` });
  } catch (error) {
    console.error('Generate preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Post to Instagram (after preview is ready)
router.post('/ideas/:id/post-to-instagram', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const idea = getIdeaById(id);

    if (!idea) {
      return res.status(404).json({ error: 'Idea not found' });
    }
    if (idea.preview_status !== 'ready') {
      return res.status(400).json({ error: 'Preview not ready. Generate preview first.' });
    }

    updateIdeaStatus(id, 'processing');

    // Run async
    postIdeaToInstagram(idea).catch(err => {
      console.error(`[Post] Error for #${id}:`, err.message);
      updateIdeaStatus(id, 'failed', { error: err.message });
    });

    res.json({ message: `Posting idea #${id} to Instagram` });
  } catch (error) {
    console.error('Post to instagram error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get next scheduled idea
router.get('/next', (req, res) => {
  try {
    const next = getNextPendingIdea();
    res.json(next || { message: 'No pending ideas' });
  } catch (error) {
    console.error('Get next error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger (for testing)
router.post('/trigger', async (req, res) => {
  try {
    const { processNextIdea } = await import('../scheduler.js');
    processNextIdea().catch(err => console.error('[Manual trigger] Error:', err));
    res.json({ message: 'Processing triggered. Check server logs for progress.' });
  } catch (error) {
    console.error('Trigger error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Async helpers ---

async function generatePreviewImages(idea) {
  const { generateMultiImageCaptions, generateImageCaption } = await import('../services/openai.js');
  const { generateFluxImage } = await import('../services/fal.js');
  const { generateImage } = await import('../services/grok.js');
  const { uploadImage } = await import('../services/storage.js');

  const imageCount = idea.image_count || 1;
  const model = idea.model || 'grok';

  console.log(`[Preview] Generating ${imageCount} image(s) for idea #${idea.id}...`);

  // Step 1: Generate prompts
  let content;
  if (imageCount > 1) {
    content = await generateMultiImageCaptions(idea.prompt, imageCount);
  } else {
    const single = await generateImageCaption(idea.prompt);
    content = {
      imagePrompts: [single.imagePrompt],
      caption: single.caption,
      hashtags: single.hashtags
    };
  }

  console.log(`[Preview] Got ${content.imagePrompts.length} prompts. Generating images with ${model}...`);

  // Step 2: Generate all images in parallel
  const imageResults = await Promise.all(
    content.imagePrompts.map(async (prompt) => {
      if (model === 'flux') {
        return generateFluxImage(prompt);
      } else {
        return generateImage(prompt);
      }
    })
  );

  // Step 3: Upload all to R2 in parallel
  console.log('[Preview] Uploading images to R2...');
  const publicUrls = await Promise.all(
    imageResults.map(result => uploadImage(result.imageUrl))
  );

  const caption = `${content.caption}\n\n${content.hashtags.map(h => `#${h}`).join(' ')}`;

  // Step 4: Save preview
  updatePreviewStatus(idea.id, 'ready', {
    previewUrls: publicUrls,
    caption,
    script: JSON.stringify(content)
  });

  console.log(`[Preview] Done! ${publicUrls.length} images ready for idea #${idea.id}`);
}

async function postIdeaToInstagram(idea) {
  const { postImage, postCarousel } = await import('../services/instagram.js');

  const token = getToken();
  if (!token || !token.access_token) {
    throw new Error('No Instagram auth token found. Please log in first.');
  }
  if (token.expires_at && Date.now() > token.expires_at) {
    throw new Error('Instagram token expired. Please re-authenticate.');
  }

  const accessToken = token.page_access_token || token.access_token;
  const previewUrls = JSON.parse(idea.preview_urls);
  const caption = idea.caption;

  let result;
  if (previewUrls.length > 1) {
    console.log(`[Post] Posting carousel (${previewUrls.length} images) to Instagram...`);
    result = await postCarousel(accessToken, token.instagram_account_id, previewUrls, caption);
  } else {
    console.log('[Post] Posting single image to Instagram...');
    result = await postImage(accessToken, token.instagram_account_id, previewUrls[0], caption);
  }

  updateIdeaStatus(idea.id, 'completed', {
    videoUrl: previewUrls[0],
    caption,
    script: idea.script,
    instagramMediaId: result.id
  });

  console.log(`[Post] Successfully posted idea #${idea.id} (media ID: ${result.id})`);
}

export default router;
