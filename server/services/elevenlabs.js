import axios from 'axios';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = join(__dirname, '../uploads');

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';

// Popular voice IDs from ElevenLabs
const VOICES = {
  rachel: '21m00Tcm4TlvDq8ikWAM',
  josh: 'TxGEqnHWrfWFTfGW9XjX',
  bella: 'EXAVITQu4vr4xnSDxMaL',
  adam: 'pNInz6obpgDQGcFmaJgB',
  arnold: 'VR6AewLTigWG4xSOukaG'
};

export async function generateAudio(text, voiceId = 'rachel') {
  const voice = VOICES[voiceId] || VOICES.rachel;

  const response = await axios.post(
    `${ELEVENLABS_API_URL}/text-to-speech/${voice}`,
    {
      text,
      model_id: 'eleven_monolingual_v1',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75
      }
    },
    {
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      responseType: 'arraybuffer'
    }
  );

  // Ensure uploads directory exists
  if (!existsSync(UPLOADS_DIR)) {
    await mkdir(UPLOADS_DIR, { recursive: true });
  }

  const filename = `audio_${Date.now()}.mp3`;
  const filepath = join(UPLOADS_DIR, filename);
  await writeFile(filepath, response.data);

  return {
    filename,
    filepath,
    url: `/uploads/${filename}`
  };
}

export function getAvailableVoices() {
  return Object.keys(VOICES);
}
