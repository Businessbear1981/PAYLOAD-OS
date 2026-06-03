// Meshy — 3D model generation (text-to-3D and image-to-3D).
// Server-side only. Pattern: submit → poll → download .glb → R2.

import {uploadObject, publicUrlFor} from '@/lib/r2';

const API_KEY = process.env.MESHY_API_KEY;
const BASE = 'https://api.meshy.ai/v2';

function headers() {
  if (!API_KEY) throw new Error('MESHY_API_KEY not set');
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  };
}

export type TextTo3DInput = {
  prompt: string;
  mode?: 'preview' | 'refine';
  artStyle?: 'realistic' | 'sculpture' | 'cartoon';
  negativePrompt?: string;
};

export async function textTo3D(input: TextTo3DInput) {
  const res = await fetch(`${BASE}/text-to-3d`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      mode: input.mode ?? 'preview',
      prompt: input.prompt,
      art_style: input.artStyle ?? 'realistic',
      negative_prompt: input.negativePrompt,
    }),
  });
  if (!res.ok) throw new Error(`Meshy ${res.status}: ${await res.text()}`);
  return res.json() as Promise<{result: string}>;
}

export async function pollTask(taskId: string) {
  const res = await fetch(`${BASE}/text-to-3d/${taskId}`, {headers: headers()});
  if (!res.ok) throw new Error(`Meshy ${res.status}`);
  return res.json() as Promise<{
    id: string;
    status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED';
    model_urls?: {glb?: string; fbx?: string; usdz?: string; obj?: string};
    progress?: number;
  }>;
}

export async function downloadAndStore(modelUrl: string, ext: 'glb' | 'fbx' | 'usdz' | 'obj' = 'glb') {
  const r = await fetch(modelUrl);
  const buf = Buffer.from(await r.arrayBuffer());
  const key = `models/${crypto.randomUUID()}.${ext}`;
  const mime = ext === 'glb' ? 'model/gltf-binary' : 'application/octet-stream';
  await uploadObject(key, buf, mime);
  return {key, url: publicUrlFor(key), bytes: buf.length};
}
