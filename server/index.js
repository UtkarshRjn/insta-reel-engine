import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import generateRoutes from './routes/generate.js';
import authRoutes from './routes/auth.js';
import instagramRoutes from './routes/instagram.js';
import queueRoutes from './routes/queue.js';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../.env') });

// Start the scheduler (daily cron + weekly token refresh)
import './scheduler.js';

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());
app.use('/uploads', express.static(join(__dirname, 'uploads')));

// Routes
app.use('/api/generate', generateRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/queue', queueRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve client build in production
const clientDist = join(__dirname, '../client/dist');
if (process.env.NODE_ENV === 'production' && existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
      res.sendFile(join(clientDist, 'index.html'));
    }
  });
}

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
