// One-time script: upload character reference image to R2
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY,
    secretAccessKey: process.env.R2_SECRET_KEY
  }
});

const imageBuffer = readFileSync(join(__dirname, 'data/character-ref.png'));

await s3.send(new PutObjectCommand({
  Bucket: process.env.R2_BUCKET_NAME,
  Key: 'refs/character-ref.png',
  Body: imageBuffer,
  ContentType: 'image/png'
}));

const publicUrl = `${process.env.R2_PUBLIC_URL}/refs/character-ref.png`;
console.log(`\nUploaded! Set this in your .env:\n`);
console.log(`CHARACTER_REF_IMAGE_URL=${publicUrl}`);
