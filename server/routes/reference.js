import { Router } from 'express';
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { getRefImage, saveRefImage } from '../db.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function getS3Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY,
      secretAccessKey: process.env.R2_SECRET_KEY
    }
  });
}

// Get current reference image
router.get('/', (req, res) => {
  try {
    const ref = getRefImage();
    res.json(ref || { url: null });
  } catch (error) {
    console.error('Get ref image error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload new reference image
router.post('/', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const ext = req.file.mimetype === 'image/jpeg' ? 'jpg' : 'png';
    const filename = `refs/${randomUUID()}.${ext}`;

    const s3 = getS3Client();
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: filename,
      Body: req.file.buffer,
      ContentType: req.file.mimetype
    }));

    const publicUrl = `${process.env.R2_PUBLIC_URL}/${filename}`;
    saveRefImage(publicUrl, req.file.originalname);

    // Also update the in-memory env so scheduler picks it up immediately
    process.env.CHARACTER_REF_IMAGE_URL = publicUrl;

    res.json({ url: publicUrl, name: req.file.originalname });
  } catch (error) {
    console.error('Upload ref image error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Remove reference image (stop using it, don't delete from R2)
router.delete('/', (req, res) => {
  try {
    saveRefImage(null, null);
    process.env.CHARACTER_REF_IMAGE_URL = '';
    res.json({ success: true });
  } catch (error) {
    console.error('Remove ref image error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
