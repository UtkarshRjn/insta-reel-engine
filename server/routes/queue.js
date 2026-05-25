import { Router } from 'express';
import { addIdea, getQueue, deleteIdea, retryIdea, getNextPendingIdea, getIdeaById, updatePreviewStatus, updateIdeaStatus, getToken } from '../db.js';

const router = Router();

// Add a new idea to the queue
router.post('/ideas', (req, res) => {
  try {
    const { prompt, scheduledDate, mediaType, model, imageCount, aspectRatio } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const validType = mediaType === 'image' ? 'image' : 'video';
    const validModel = ['grok', 'flux', 'kling'].includes(model) ? model : 'grok';
    // FLUX-supported ratios that also satisfy Instagram's 0.8–1.91 feed constraint
    const validFluxRatios = ['1:1', '4:3', '3:2', '16:9'];
    const validAspectRatio = (validType === 'image' && validModel === 'flux' && validFluxRatios.includes(aspectRatio))
      ? aspectRatio
      : null;
    const idea = addIdea(prompt.trim(), scheduledDate || null, validType, validModel, imageCount, validAspectRatio);
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

// Regenerate a single image in the preview with a custom prompt
router.post('/ideas/:id/regenerate-image', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { index, prompt: customPrompt } = req.body;
    const idea = getIdeaById(id);

    if (!idea) return res.status(404).json({ error: 'Idea not found' });
    if (idea.preview_status !== 'ready') {
      return res.status(400).json({ error: 'Preview must be ready first' });
    }

    const previewUrls = JSON.parse(idea.preview_urls || '[]');
    if (!Number.isInteger(index) || index < 0 || index >= previewUrls.length) {
      return res.status(400).json({ error: 'Invalid image index' });
    }
    if (!customPrompt || !customPrompt.trim()) {
      return res.status(400).json({ error: 'Custom prompt is required' });
    }

    // Mark as regenerating so the UI can poll/spinner
    updatePreviewStatus(id, 'generating', {
      previewUrls,
      caption: idea.caption,
      script: idea.script
    });

    regenerateSingleImage(idea, index, customPrompt.trim()).catch(err => {
      console.error(`[Regen] Error for #${id} img ${index}:`, err.message);
      // Restore ready state with the old URLs on failure
      updatePreviewStatus(id, 'ready', {
        previewUrls,
        caption: idea.caption,
        script: idea.script,
        error: err.message
      });
    });

    res.json({ message: `Regenerating image #${index} for idea ${id}` });
  } catch (error) {
    console.error('Regenerate image error:', error);
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
      const igError = err.response?.data?.error;
      const detail = igError ? `${igError.message} (code ${igError.code}, type ${igError.type})` : err.message;
      console.error(`[Post] Error for #${id}:`, detail);
      if (err.response?.data) console.error('[Post] Full response:', JSON.stringify(err.response.data));
      updateIdeaStatus(id, 'failed', { error: detail });
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
  const fluxOptions = idea.aspect_ratio ? { aspectRatio: idea.aspect_ratio } : {};
  const imageResults = await Promise.all(
    content.imagePrompts.map(async (prompt) => {
      if (model === 'flux') {
        return generateFluxImage(prompt, fluxOptions);
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

async function regenerateSingleImage(idea, index, customPrompt) {
  const { generateFluxImage } = await import('../services/fal.js');
  const { generateImage } = await import('../services/grok.js');
  const { uploadImage } = await import('../services/storage.js');

  const model = idea.model || 'grok';
  console.log(`[Regen] Idea #${idea.id} image ${index} (${model}): "${customPrompt.substring(0, 60)}..."`);

  let result;
  if (model === 'flux') {
    const fluxOpts = idea.aspect_ratio ? { aspectRatio: idea.aspect_ratio } : {};
    result = await generateFluxImage(customPrompt, fluxOpts);
  } else {
    result = await generateImage(customPrompt);
  }

  console.log(`[Regen] Uploading new image to R2...`);
  const publicUrl = await uploadImage(result.imageUrl);

  // Re-read preview URLs (in case anything changed) and swap in the new one
  const fresh = getIdeaById(idea.id);
  const previewUrls = JSON.parse(fresh.preview_urls || '[]');
  previewUrls[index] = publicUrl;

  updatePreviewStatus(idea.id, 'ready', {
    previewUrls,
    caption: fresh.caption,
    script: fresh.script
  });

  console.log(`[Regen] Done for idea #${idea.id} image ${index}`);
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
