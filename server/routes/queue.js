import { Router } from 'express';
import { addIdea, getQueue, deleteIdea, retryIdea, getNextPendingIdea } from '../db.js';

const router = Router();

// Add a new idea to the queue
router.post('/ideas', (req, res) => {
  try {
    const { prompt, scheduledDate, mediaType, model } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const validType = mediaType === 'image' ? 'image' : 'video';
    const validModel = ['grok', 'flux', 'kling'].includes(model) ? model : 'grok';
    const idea = addIdea(prompt.trim(), scheduledDate || null, validType, validModel);
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

// Post a specific idea now (skip schedule)
router.post('/ideas/:id/post-now', async (req, res) => {
  try {
    const { processIdeaById } = await import('../scheduler.js');
    const id = Number(req.params.id);
    // Run async, respond immediately
    processIdeaById(id).catch(err => console.error(`[Post Now] Error for #${id}:`, err.message));
    res.json({ message: `Processing idea #${id}. Check server logs for progress.` });
  } catch (error) {
    console.error('Post now error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual trigger (for testing)
router.post('/trigger', async (req, res) => {
  try {
    const { processNextIdea } = await import('../scheduler.js');
    // Run async, respond immediately
    processNextIdea().catch(err => console.error('[Manual trigger] Error:', err));
    res.json({ message: 'Processing triggered. Check server logs for progress.' });
  } catch (error) {
    console.error('Trigger error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
