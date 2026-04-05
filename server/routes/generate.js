import { Router } from 'express';
import { generateReelContent } from '../services/openai.js';
import { generateVideoWithAudio, estimateCost } from '../services/grok.js';

const router = Router();

// Generate script from context
router.post('/script', async (req, res) => {
  try {
    const { context } = req.body;

    if (!context) {
      return res.status(400).json({ error: 'Context is required' });
    }

    const content = await generateReelContent(context);
    res.json(content);
  } catch (error) {
    console.error('Script generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate video with native audio using Grok (xAI Aurora)
router.post('/video', async (req, res) => {
  try {
    const {
      prompt,
      audioPrompt = null,
      duration = 10,
      aspectRatio = '9:16'
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const video = await generateVideoWithAudio(prompt, audioPrompt, {
      duration,
      aspectRatio
    });

    res.json(video);
  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get cost estimate for video generation
router.get('/video/estimate', (req, res) => {
  const { duration = 10, withAudio = true } = req.query;
  const estimate = estimateCost(Number(duration), withAudio === 'true' || withAudio === true);
  res.json(estimate);
});

// Full generation pipeline (script + video with audio)
router.post('/full', async (req, res) => {
  try {
    const {
      context,
      videoDuration = 10, // default 10 seconds
      aspectRatio = '9:16'
    } = req.body;

    if (!context) {
      return res.status(400).json({ error: 'Context is required' });
    }

    // Validate duration (5-30 seconds for reels)
    const targetDuration = Math.min(Math.max(videoDuration, 5), 30);

    // Step 1: Generate script and video prompt using OpenAI
    console.log('Step 1: Generating script and video prompt...');
    const content = await generateReelContent(context);

    // Step 2: Generate video with native audio using Grok (xAI Aurora)
    console.log('Step 2: Generating video with audio using Grok...');
    // Grok supports up to 15s natively, no multi-clip needed
    const video = await generateVideoWithAudio(content.videoPrompt, content.script, {
      duration: Math.min(targetDuration, 15),
      aspectRatio
    });

    res.json({
      content,
      video,
      cost: video.cost
    });
  } catch (error) {
    console.error('Full generation error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
