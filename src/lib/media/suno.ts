// Suno — music generation. Server-side only.
// Pattern: submit → poll → download .mp3 → R2.
//
// Suno's public API is third-party-wrapped (no first-party API). This stub
// uses the common community-API shape; swap BASE + auth shape for your provider.

import {uploadObject, publicUrlFor} from '@/lib/r2';

const API_KEY = process.env.SUNO_API_KEY;
const BASE = process.env.SUNO_API_BASE ?? 'https://api.sunoapi.com/v1';

function headers() {
  if (!API_KEY) throw new Error('SUNO_API_KEY not set');
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export type GenerateMusicInput = {
  prompt: string;
  style?: string;          // 'lo-fi', 'cinematic', 'pop', etc.
  title?: string;
  durationSeconds?: number;
  instrumental?: boolean;
  customMode?: boolean;    // true = use lyrics + style directly
  lyrics?: string;
};

export async function generateMusic(input: GenerateMusicInput) {
  const res = await fetch(`${BASE}/generate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      prompt: input.prompt,
      style: input.style,
      title: input.title,
      duration: input.durationSeconds,
      make_instrumental: input.instrumental ?? false,
      custom_mode: input.customMode ?? false,
      lyrics: input.lyrics,
    }),
  });
  if (!res.ok) throw new Error(`Suno ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{id: string; status: string}>;
}

export async function pollTrack(trackId: string) {
  const res = await fetch(`${BASE}/tracks/${trackId}`, {headers: headers()});
  if (!res.ok) throw new Error(`Suno ${res.status}`);
  return res.json() as Promise<{
    id: string;
    status: 'queued' | 'streaming' | 'complete' | 'failed';
    audio_url?: string;
    duration?: number;
    title?: string;
  }>;
}

export async function downloadAndStore(audioUrl: string) {
  const r = await fetch(audioUrl);
  const buf = Buffer.from(await r.arrayBuffer());
  const key = `music/${crypto.randomUUID()}.mp3`;
  await uploadObject(key, buf, 'audio/mpeg');
  return {key, url: publicUrlFor(key), bytes: buf.length};
}
