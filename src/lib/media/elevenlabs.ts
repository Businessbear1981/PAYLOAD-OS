// ElevenLabs voice/TTS — server-side only.
// Generates speech audio from text, writes the result to Cloudflare R2,
// returns the public URL and a media_assets row id.

import {uploadObject, publicUrlFor} from '@/lib/r2';

const API_KEY = process.env.ELEVENLABS_API_KEY;
const DEFAULT_VOICE = process.env.ELEVENLABS_DEFAULT_VOICE_ID;
const BASE = 'https://api.elevenlabs.io/v1';

export type TtsRequest = {
  text: string;
  voiceId?: string;
  modelId?: string;             // e.g. 'eleven_multilingual_v2'
  stability?: number;           // 0..1
  similarityBoost?: number;     // 0..1
};

export async function tts({text, voiceId, modelId = 'eleven_multilingual_v2', stability = 0.5, similarityBoost = 0.75}: TtsRequest) {
  if (!API_KEY) throw new Error('ELEVENLABS_API_KEY not set');
  const vid = voiceId ?? DEFAULT_VOICE;
  if (!vid) throw new Error('voiceId required (or set ELEVENLABS_DEFAULT_VOICE_ID)');

  const res = await fetch(`${BASE}/text-to-speech/${vid}`, {
    method: 'POST',
    headers: {
      'xi-api-key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {stability, similarity_boost: similarityBoost},
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);

  const audio = Buffer.from(await res.arrayBuffer());
  const key = `voice/${crypto.randomUUID()}.mp3`;
  await uploadObject(key, audio, 'audio/mpeg');
  return {key, url: publicUrlFor(key), bytes: audio.length};
}

export async function listVoices() {
  if (!API_KEY) throw new Error('ELEVENLABS_API_KEY not set');
  const res = await fetch(`${BASE}/voices`, {headers: {'xi-api-key': API_KEY}});
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
  return res.json();
}
