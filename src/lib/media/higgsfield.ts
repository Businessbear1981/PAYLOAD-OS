// Higgsfield — image + short-form video generation. Server-side only.
// API patterns vary per product (GPT Image 2, Seedance, Soul, etc.);
// this stub covers the common shape: submit job → poll → download → R2 upload.

import {uploadObject, publicUrlFor} from '@/lib/r2';

const KEY_ID = process.env.HIGGSFIELD_API_KEY_ID;
const SECRET = process.env.HIGGSFIELD_API_SECRET;
const BASE = process.env.HIGGSFIELD_API_BASE ?? 'https://platform.higgsfield.ai/v1';

function authHeaders() {
  if (!KEY_ID || !SECRET) throw new Error('HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_SECRET not set');
  return {
    'hf-api-key': KEY_ID,
    'hf-secret': SECRET,
    'Content-Type': 'application/json',
  };
}

export type ImageJobInput = {
  prompt: string;
  model?: string;       // 'gpt-image-2' | 'nano-banana-2' | etc.
  aspectRatio?: '1:1' | '16:9' | '9:16' | '4:5';
  referenceImageUrl?: string;
};

export async function submitImageJob(input: ImageJobInput) {
  const res = await fetch(`${BASE}/jobs/image`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Higgsfield ${res.status}: ${await res.text()}`);
  const job = await res.json();
  return job as {id: string; status: string};
}

export async function pollJob(jobId: string) {
  const res = await fetch(`${BASE}/jobs/${jobId}`, {headers: authHeaders()});
  if (!res.ok) throw new Error(`Higgsfield ${res.status}`);
  return res.json() as Promise<{id: string; status: string; result?: {url: string}}>;
}

export async function downloadAndStore(resultUrl: string, kind: 'image' | 'video' = 'image') {
  const r = await fetch(resultUrl);
  const buf = Buffer.from(await r.arrayBuffer());
  const ext = kind === 'video' ? 'mp4' : 'png';
  const mime = kind === 'video' ? 'video/mp4' : 'image/png';
  const key = `${kind}/${crypto.randomUUID()}.${ext}`;
  await uploadObject(key, buf, mime);
  return {key, url: publicUrlFor(key), bytes: buf.length};
}
