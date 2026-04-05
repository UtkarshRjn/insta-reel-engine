import { Router } from 'express';
import {
  getAuthUrl,
  exchangeCodeForToken,
  getLongLivedToken,
  getInstagramAccountId,
  getUserProfile
} from '../services/instagram.js';
import { saveToken } from '../db.js';

const router = Router();

// In-memory session store (kept for backward compatibility with existing UI flows)
const sessions = new Map();

// Start Instagram OAuth flow
router.get('/instagram', (req, res) => {
  const authUrl = getAuthUrl();
  res.redirect(authUrl);
});

// OAuth callback
router.get('/instagram/callback', async (req, res) => {
  try {
    const { code, error } = req.query;

    if (error) {
      return res.redirect(`${process.env.CLIENT_URL}?error=${error}`);
    }

    if (!code) {
      return res.redirect(`${process.env.CLIENT_URL}?error=no_code`);
    }

    // Exchange code for token
    const tokenData = await exchangeCodeForToken(code);

    // Get long-lived token
    const longLivedToken = await getLongLivedToken(tokenData.access_token);

    // Get Instagram account ID
    const { instagramAccountId, pageAccessToken } = await getInstagramAccountId(longLivedToken.access_token);

    // Get user profile
    const profile = await getUserProfile(pageAccessToken, instagramAccountId);

    // Generate session ID
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const expiresAt = Date.now() + (longLivedToken.expires_in * 1000);

    // Store session in memory (for current UI session)
    sessions.set(sessionId, {
      accessToken: pageAccessToken,
      instagramAccountId,
      profile,
      expiresAt
    });

    // Persist token to SQLite (for scheduler / across restarts)
    saveToken({
      instagramAccountId,
      accessToken: longLivedToken.access_token,
      pageAccessToken,
      username: profile.username,
      expiresAt
    });

    // Redirect to client with session ID
    res.redirect(`${process.env.CLIENT_URL}?session=${sessionId}`);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect(`${process.env.CLIENT_URL}?error=${encodeURIComponent(error.message)}`);
  }
});

// Get current session info
router.get('/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);

  if (!session) {
    return res.status(401).json({ error: 'Session not found' });
  }

  if (Date.now() > session.expiresAt) {
    sessions.delete(req.params.sessionId);
    return res.status(401).json({ error: 'Session expired' });
  }

  res.json({
    profile: session.profile,
    instagramAccountId: session.instagramAccountId
  });
});

// Logout
router.post('/logout/:sessionId', (req, res) => {
  sessions.delete(req.params.sessionId);
  res.json({ success: true });
});

// Export sessions for use in other routes
export { sessions };
export default router;
