import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import axios from 'axios';
import { randomUUID } from 'crypto';

let s3Client = null;

function getS3Client() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY,
        secretAccessKey: process.env.R2_SECRET_KEY
      }
    });
  }
  return s3Client;
}

/**
 * Download video from a URL and upload it to Cloudflare R2
 * Returns a publicly accessible URL for Instagram to fetch
 */
export async function uploadVideo(videoUrl) {
  console.log('Downloading video from Grok...');
  const response = await axios.get(videoUrl, { responseType: 'arraybuffer' });
  const videoBuffer = Buffer.from(response.data);

  const filename = `reels/${randomUUID()}.mp4`;

  console.log(`Uploading to R2: ${filename}`);
  const client = getS3Client();
  await client.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: filename,
    Body: videoBuffer,
    ContentType: 'video/mp4'
  }));

  const publicUrl = `${process.env.R2_PUBLIC_URL}/${filename}`;
  console.log(`Uploaded to R2: ${publicUrl}`);
  return publicUrl;
}
