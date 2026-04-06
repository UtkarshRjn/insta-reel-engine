import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Use DATA_DIR env var for Railway persistent volumes, fallback to local
const dataDir = process.env.DATA_DIR || join(__dirname, 'data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const dbPath = join(dataDir, 'reels.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS ideas_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prompt TEXT NOT NULL,
    media_type TEXT DEFAULT 'video' CHECK(media_type IN ('video', 'image')),
    model TEXT DEFAULT 'grok' CHECK(model IN ('grok', 'flux', 'kling')),
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    scheduled_date DATE,
    video_url TEXT,
    caption TEXT,
    script TEXT,
    instagram_media_id TEXT,
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS auth_tokens (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id = 1),
    instagram_account_id TEXT,
    access_token TEXT,
    page_access_token TEXT,
    username TEXT,
    expires_at INTEGER,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// --- Schema migrations (idempotent) ---
try { db.exec('ALTER TABLE ideas_queue ADD COLUMN image_count INTEGER DEFAULT 1'); } catch(e) {}
try { db.exec('ALTER TABLE ideas_queue ADD COLUMN preview_urls TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE ideas_queue ADD COLUMN preview_status TEXT'); } catch(e) {}

// --- Ideas Queue ---

const stmtInsertIdea = db.prepare(`
  INSERT INTO ideas_queue (prompt, media_type, model, scheduled_date, image_count) VALUES (?, ?, ?, ?, ?)
`);

const stmtGetNextPending = db.prepare(`
  SELECT * FROM ideas_queue
  WHERE status = 'pending' AND scheduled_date <= date('now')
  ORDER BY scheduled_date ASC, id ASC
  LIMIT 1
`);

const stmtUpdateStatus = db.prepare(`
  UPDATE ideas_queue SET status = ?, video_url = ?, caption = ?, script = ?,
    instagram_media_id = ?, error = ?
  WHERE id = ?
`);

const stmtGetQueue = db.prepare(`
  SELECT * FROM ideas_queue ORDER BY scheduled_date DESC, id DESC
`);

const stmtGetQueueByStatus = db.prepare(`
  SELECT * FROM ideas_queue WHERE status = ? ORDER BY scheduled_date ASC, id ASC
`);

const stmtDeleteIdea = db.prepare(`
  DELETE FROM ideas_queue WHERE id = ? AND status = 'pending'
`);

const stmtResetIdea = db.prepare(`
  UPDATE ideas_queue SET status = 'pending', error = NULL WHERE id = ? AND status = 'failed'
`);

const stmtGetNextDate = db.prepare(`
  SELECT MAX(scheduled_date) as last_date FROM ideas_queue
  WHERE status IN ('pending', 'processing')
`);

const stmtGetIdeaById = db.prepare(`
  SELECT * FROM ideas_queue WHERE id = ?
`);

export function addIdea(prompt, scheduledDate = null, mediaType = 'video', model = null, imageCount = 1) {
  // Auto-assign model based on media type if not specified
  if (!model) {
    model = mediaType === 'image' ? 'grok' : 'grok';
  }

  if (!scheduledDate) {
    const row = stmtGetNextDate.get();
    if (row && row.last_date) {
      const lastDate = new Date(row.last_date);
      lastDate.setDate(lastDate.getDate() + 1);
      scheduledDate = lastDate.toISOString().split('T')[0];
    } else {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      scheduledDate = tomorrow.toISOString().split('T')[0];
    }
  }

  const count = mediaType === 'image' ? Math.min(Math.max(Number(imageCount) || 1, 1), 5) : 1;
  const result = stmtInsertIdea.run(prompt, mediaType, model, scheduledDate, count);
  return stmtGetIdeaById.get(result.lastInsertRowid);
}

export function getNextPendingIdea() {
  return stmtGetNextPending.get() || null;
}

export function updateIdeaStatus(id, status, data = {}) {
  stmtUpdateStatus.run(
    status,
    data.videoUrl || null,
    data.caption || null,
    data.script || null,
    data.instagramMediaId || null,
    data.error || null,
    id
  );
}

export function getQueue(status = null) {
  if (status) {
    return stmtGetQueueByStatus.all(status);
  }
  return stmtGetQueue.all();
}

export function deleteIdea(id) {
  const result = stmtDeleteIdea.run(id);
  return result.changes > 0;
}

export function retryIdea(id) {
  const result = stmtResetIdea.run(id);
  return result.changes > 0;
}

export function getIdeaById(id) {
  return stmtGetIdeaById.get(id) || null;
}

const stmtUpdatePreview = db.prepare(`
  UPDATE ideas_queue SET preview_status = ?, preview_urls = ?, caption = ?, script = ?, error = ? WHERE id = ?
`);

export function updatePreviewStatus(id, previewStatus, data = {}) {
  stmtUpdatePreview.run(
    previewStatus,
    data.previewUrls ? JSON.stringify(data.previewUrls) : null,
    data.caption || null,
    data.script || null,
    data.error || null,
    id
  );
}

// --- Auth Tokens ---

const stmtSaveToken = db.prepare(`
  INSERT OR REPLACE INTO auth_tokens (id, instagram_account_id, access_token, page_access_token, username, expires_at, updated_at)
  VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
`);

const stmtGetToken = db.prepare(`
  SELECT * FROM auth_tokens WHERE id = 1
`);

export function saveToken({ instagramAccountId, accessToken, pageAccessToken, username, expiresAt }) {
  stmtSaveToken.run(instagramAccountId, accessToken, pageAccessToken, username, expiresAt);
}

export function getToken() {
  return stmtGetToken.get() || null;
}

// --- Settings (reference image, etc.) ---

const stmtGetSetting = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const stmtSaveSetting = db.prepare(`
  INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
`);

// Seed ref image from env if DB is empty
const existingRef = stmtGetSetting.get('ref_image_url');
if ((!existingRef || !existingRef.value) && process.env.CHARACTER_REF_IMAGE_URL) {
  stmtSaveSetting.run('ref_image_url', process.env.CHARACTER_REF_IMAGE_URL);
  stmtSaveSetting.run('ref_image_name', 'character-ref.png');
}

export function getRefImage() {
  const url = stmtGetSetting.get('ref_image_url');
  const name = stmtGetSetting.get('ref_image_name');
  if (!url || !url.value) return null;
  return { url: url.value, name: name?.value || 'character-ref.png' };
}

export function saveRefImage(url, name) {
  stmtSaveSetting.run('ref_image_url', url);
  stmtSaveSetting.run('ref_image_name', name);
}

export default db;
