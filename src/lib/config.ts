// Runtime config loader. Reads vendor credentials from the integrations
// vault first, falls back to process.env, throws on missing.
//
// Lib clients (lib/r2.ts, lib/stripe.ts, lib/ai.ts, lib/media/*) should
// call `getConfig('<vendor>')` instead of touching process.env directly,
// so a /settings/integrations save takes effect without a redeploy.
//
// In dev, you can use .env.local; in prod, the vault is the source of truth.

import {createClient} from '@supabase/supabase-js';
import {decryptJson} from './crypto';

type VendorConfig = Record<string, string>;
type CacheEntry = {at: number; data: VendorConfig; enabled: boolean};

const CACHE: Map<string, CacheEntry> = new Map();
const TTL_MS = 60_000;

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {auth: {persistSession: false}},
  );
}

// Read one vendor's config. Throws if disabled or missing.
export async function getConfig(vendor: string): Promise<VendorConfig> {
  const cached = CACHE.get(vendor);
  if (cached && Date.now() - cached.at < TTL_MS) {
    if (!cached.enabled) throw new IntegrationDisabledError(vendor);
    return cached.data;
  }

  const {data, error} = await admin()
    .from('integrations')
    .select('enabled, ciphertext, iv')
    .eq('vendor', vendor)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    // No vault row — fall back to env var.
    return fromEnv(vendor);
  }

  CACHE.set(vendor, {at: Date.now(), data: {}, enabled: data.enabled});

  if (!data.enabled) throw new IntegrationDisabledError(vendor);

  if (!data.ciphertext) {
    // Row exists but no credentials saved yet — fall back to env.
    return fromEnv(vendor);
  }

  const decrypted = decryptJson<VendorConfig>({
    ciphertext: Buffer.from(data.ciphertext),
    iv: Buffer.from(data.iv),
  });
  CACHE.set(vendor, {at: Date.now(), data: decrypted, enabled: true});
  return decrypted;
}

export function invalidateConfig(vendor?: string) {
  if (vendor) CACHE.delete(vendor);
  else CACHE.clear();
}

export class IntegrationDisabledError extends Error {
  constructor(public vendor: string) {
    super(`Integration "${vendor}" is disabled. Enable it at /settings/integrations.`);
    this.name = 'IntegrationDisabledError';
  }
}

// Env-var fallback. Map vendor → expected env names. Keep this list in sync
// with the seed in integrations.sql.
function fromEnv(vendor: string): VendorConfig {
  const map: Record<string, Record<string, string | undefined>> = {
    supabase: {
      url: process.env.NEXT_PUBLIC_SUPABASE_URL,
      anon_key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    cloudflare_r2: {
      account_id: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_R2_TOKEN,
      secret: process.env.CLOUDFLARE_R2_SECRET,
      bucket: process.env.R2_BUCKET,
      public_url: process.env.R2_PUBLIC_URL,
    },
    ai_gateway: {
      api_key: process.env.AI_GATEWAY_API_KEY,
      default_model: 'anthropic/claude-opus-4-6',
    },
    stripe: {
      publishable_key: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
      secret_key: process.env.STRIPE_SECRET_KEY,
      webhook_secret: process.env.STRIPE_WEBHOOK_SECRET,
    },
    elevenlabs: {
      api_key: process.env.ELEVENLABS_API_KEY,
      default_voice_id: process.env.ELEVENLABS_DEFAULT_VOICE_ID,
    },
    higgsfield: {
      api_key_id: process.env.HIGGSFIELD_API_KEY_ID,
      api_secret: process.env.HIGGSFIELD_API_SECRET,
      api_base: process.env.HIGGSFIELD_API_BASE,
    },
    meshy: {api_key: process.env.MESHY_API_KEY},
    suno: {api_key: process.env.SUNO_API_KEY, api_base: process.env.SUNO_API_BASE},
    langsmith: {api_key: process.env.LANGSMITH_API_KEY, project: process.env.LANGSMITH_PROJECT},
    porkbun: {api_key: process.env.PORKBUN_API_KEY, secret_key: process.env.PORKBUN_SECRET_KEY},
    railway: {project_id: process.env.RAILWAY_PROJECT_ID, token: process.env.RAILWAY_TOKEN},
    vercel: {token: process.env.VERCEL_TOKEN, team_id: process.env.VERCEL_TEAM_ID},
  };
  const obj = map[vendor] ?? {};
  // Filter out undefined values; throw if every key is empty.
  const result: VendorConfig = {};
  for (const [k, v] of Object.entries(obj)) if (v) result[k] = v;
  if (Object.keys(result).length === 0) {
    throw new Error(
      `Vendor "${vendor}" has no credentials configured. Set them at /settings/integrations or in .env.local.`,
    );
  }
  return result;
}
