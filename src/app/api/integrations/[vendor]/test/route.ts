import {NextResponse, type NextRequest} from 'next/server';
import {createClient as createSupa} from '@supabase/supabase-js';
import {createClient} from '@/lib/supabase/server';
import {getConfig, IntegrationDisabledError} from '@/lib/config';

export const runtime = 'nodejs';

async function requireAdmin() {
  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) return null;
  const {data: profile} = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !['admin', 'owner'].includes(profile.role)) return null;
  return user;
}

type TestResult = {
  vendor: string;
  status: 'ok' | 'fail' | 'no_quota' | 'disabled';
  latency_ms: number;
  message: string;
  details?: Record<string, unknown>;
};

export async function POST(_req: NextRequest, ctx: {params: Promise<{vendor: string}>}) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({error: 'forbidden'}, {status: 403});

  const {vendor} = await ctx.params;
  const start = Date.now();

  try {
    const cfg = await getConfig(vendor);
    const result = await runTest(vendor, cfg);
    result.latency_ms = Date.now() - start;

    // Persist outcome on the integrations row + audit log
    const admin = createSupa(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {auth: {persistSession: false}},
    );
    await admin.from('integrations').update({
      last_tested_at: new Date().toISOString(),
      last_test_status: result.status,
      last_test_message: result.message,
      last_test_latency_ms: result.latency_ms,
    }).eq('vendor', vendor);
    await admin.from('integration_audits').insert({
      vendor,
      check_name: 'connection',
      status: result.status === 'ok' ? 'ok' : result.status === 'no_quota' ? 'warn' : 'fail',
      latency_ms: result.latency_ms,
      message: result.message,
      details: result.details ?? {},
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof IntegrationDisabledError ? 'disabled' : 'fail';
    return NextResponse.json({
      vendor,
      status,
      latency_ms: Date.now() - start,
      message,
    } satisfies TestResult);
  }
}

// One real call per vendor — auth-cheap endpoint that proves the key works.
async function runTest(vendor: string, cfg: Record<string, string>): Promise<TestResult> {
  switch (vendor) {
    case 'supabase': {
      const admin = createSupa(cfg.url, cfg.service_role_key, {auth: {persistSession: false}});
      const {error} = await admin.from('profiles').select('id').limit(1);
      if (error) return {vendor, status: 'fail', latency_ms: 0, message: error.message};
      return {vendor, status: 'ok', latency_ms: 0, message: 'connected'};
    }
    case 'cloudflare_r2': {
      // HeadBucket via S3-compatible endpoint
      const {S3Client, HeadBucketCommand} = await import('@aws-sdk/client-s3');
      const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${cfg.account_id}.r2.cloudflarestorage.com`,
        credentials: {accessKeyId: cfg.token, secretAccessKey: cfg.secret ?? cfg.token},
      });
      await s3.send(new HeadBucketCommand({Bucket: cfg.bucket}));
      return {vendor, status: 'ok', latency_ms: 0, message: `bucket ${cfg.bucket} reachable`};
    }
    case 'ai_gateway': {
      // 1-token completion as a heartbeat
      const res = await fetch('https://ai-gateway.vercel.sh/v1/chat/completions', {
        method: 'POST',
        headers: {Authorization: `Bearer ${cfg.api_key}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({
          model: cfg.default_model ?? 'anthropic/claude-opus-4-6',
          messages: [{role: 'user', content: 'hi'}],
          max_tokens: 1,
        }),
      });
      if (!res.ok) {
        return {vendor, status: 'fail', latency_ms: 0, message: `${res.status} ${await res.text().then(t => t.slice(0, 200))}`};
      }
      return {vendor, status: 'ok', latency_ms: 0, message: 'gateway responded'};
    }
    case 'stripe': {
      const res = await fetch('https://api.stripe.com/v1/balance', {
        headers: {Authorization: `Bearer ${cfg.secret_key}`},
      });
      if (!res.ok) return {vendor, status: 'fail', latency_ms: 0, message: `Stripe ${res.status}`};
      return {vendor, status: 'ok', latency_ms: 0, message: 'key valid'};
    }
    case 'elevenlabs': {
      const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
        headers: {'xi-api-key': cfg.api_key},
      });
      if (!res.ok) return {vendor, status: 'fail', latency_ms: 0, message: `ElevenLabs ${res.status}`};
      const sub = (await res.json()) as {character_count?: number; character_limit?: number};
      const remaining = (sub.character_limit ?? 0) - (sub.character_count ?? 0);
      if (remaining < 100) {
        return {vendor, status: 'no_quota', latency_ms: 0, message: `Only ${remaining} characters left`, details: sub};
      }
      return {vendor, status: 'ok', latency_ms: 0, message: `${remaining} characters left`, details: sub};
    }
    case 'higgsfield': {
      const res = await fetch(`${cfg.api_base ?? 'https://platform.higgsfield.ai/v1'}/account`, {
        headers: {'hf-api-key': cfg.api_key_id, 'hf-secret': cfg.api_secret},
      });
      if (!res.ok) return {vendor, status: 'fail', latency_ms: 0, message: `Higgsfield ${res.status}`};
      return {vendor, status: 'ok', latency_ms: 0, message: 'key valid'};
    }
    case 'meshy': {
      const res = await fetch('https://api.meshy.ai/v2/text-to-3d', {
        headers: {Authorization: `Bearer ${cfg.api_key}`},
      });
      // Meshy returns 200 with list or 401/403 on bad key
      if (res.status === 401 || res.status === 403) {
        return {vendor, status: 'fail', latency_ms: 0, message: `Meshy ${res.status}`};
      }
      return {vendor, status: 'ok', latency_ms: 0, message: 'key valid'};
    }
    case 'suno':
    case 'langsmith':
    case 'porkbun':
    case 'railway':
    case 'vercel': {
      // Stubs — vendor-specific check goes here. For now, report not-implemented.
      return {
        vendor,
        status: 'fail',
        latency_ms: 0,
        message: `test not implemented for ${vendor} — wire a real check in /api/integrations/[vendor]/test/route.ts`,
      };
    }
    default:
      return {vendor, status: 'fail', latency_ms: 0, message: `unknown vendor: ${vendor}`};
  }
}
