import { Router } from 'express';
import { postReel } from '../services/instagram.js';
import { sessions } from './auth.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const router = Router();

// Post reel to Instagram
router.post('/post', async (req, res) => {
  try {
    const { sessionId, videoUrl, caption } = req.body;

    if (!sessionId) {
      return res.status(401).json({ error: 'Session ID is required' });
    }

    const session = sessions.get(sessionId);

    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired session' });
    }

    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    // For local videos, construct full URL
    // Note: Instagram requires publicly accessible URLs
    // In production, you'd upload to a CDN first
    let publicVideoUrl = videoUrl;
    if (videoUrl.startsWith('/uploads/')) {
      // This won't work in production - need to use ngrok or upload to CDN
      publicVideoUrl = `${req.protocol}://${req.get('host')}${videoUrl}`;
    }

    const result = await postReel(
      session.accessToken,
      session.instagramAccountId,
      publicVideoUrl,
      caption || ''
    );

    res.json({
      success: true,
      mediaId: result.id
    });
  } catch (error) {
    console.error('Instagram post error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
