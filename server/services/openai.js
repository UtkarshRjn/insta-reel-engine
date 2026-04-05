import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '../../.env') });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export async function generateReelContent(humanContext) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert social media content creator specializing in Instagram Reels.
Your job is to take a human's rough idea/context and transform it into:
1. A compelling voiceover script (15-30 seconds when spoken)
2. A video prompt for AI video generation

Keep the tone engaging, authentic, and optimized for short-form video content.
The script should be conversational and hook viewers in the first 3 seconds.`
      },
      {
        role: 'user',
        content: `Create reel content from this context: "${humanContext}"

Respond in JSON format:
{
  "script": "The voiceover script to be spoken",
  "videoPrompt": "Detailed prompt for AI video generation that matches the script",
  "hashtags": ["relevant", "hashtags"],
  "caption": "Instagram caption for the post"
}`
      }
    ],
    response_format: { type: 'json_object' }
  });

  const content = JSON.parse(response.choices[0].message.content);
  return content;
}

export async function generateImageCaption(humanContext) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are an expert social media content creator specializing in Instagram image posts.
Your job is to take a human's rough idea/context and transform it into:
1. A detailed image prompt for AI image generation
2. An engaging Instagram caption
3. Relevant hashtags

The image prompt should be highly detailed and visual. The caption should be engaging and authentic.`
      },
      {
        role: 'user',
        content: `Create Instagram image post content from this context: "${humanContext}"

Respond in JSON format:
{
  "imagePrompt": "Detailed prompt for AI image generation",
  "hashtags": ["relevant", "hashtags"],
  "caption": "Instagram caption for the post"
}`
      }
    ],
    response_format: { type: 'json_object' }
  });

  const content = JSON.parse(response.choices[0].message.content);
  return content;
}
