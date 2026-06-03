import {NextResponse, type NextRequest} from 'next/server';
import {createClient as createSupa} from '@supabase/supabase-js';
import {createClient} from '@/lib/supabase/server';

export const runtime = 'nodejs';
// Allow long runs — every integration is tested in parallel but some may take 10s+.
export const maxDuration = 60;

type CheckResult = {
  kind: 'integration' | 'webhook' | 'critical_path';
  name: string;
  status: 'ok' | 'fail' | 'warn' | 'disabled';
  latency_ms: number;
  message: string;
};

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

export async function POST(req: NextRequest) {
  // Allow CLI usage with an admin bearer token (set INTEGRATIONS_CLI_TOKEN env)
  const cliToken = process.env.INTEGRATIONS_CLI_TOKEN;
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const isCli = cliToken && bearer === cliToken;

  if (!isCli) {
    const user = await requireAdmin();
    if (!user) return NextResponse.json({error: 'forbidden'}, {status: 403});
  }

  const origin = new URL(req.url).origin;
  const admin = createSupa(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {auth: {persistSession: false}},
  );

  // Fetch all enabled integrations
  const {data: rows, error} = await admin
    .from('integrations')
    .select('vendor, display_name, enabled')
    .order('display_name');
  if (error) return NextResponse.json({error: error.message}, {status: 500});

  // Run integration tests in parallel
  const integrationChecks = await Promise.all(
    (rows ?? []).map(async (row): Promise<CheckResult> => {
      if (!row.enabled) {
        return {
          kind: 'integration',
          name: row.display_name,
          status: 'disabled',
          latency_ms: 0,
          message: 'disabled in /settings/integrations',
        };
      }
      const start = Date.now();
      try {
        const res = await fetch(`${origin}/api/integrations/${row.vendor}/test`, {
          method: 'POST',
          headers: isCli && cliToken ? {Authorization: `Bearer ${cliToken}`} : {},
        });
        const j = await res.json();
        return {
          kind: 'integration',
          name: row.display_name,
          status: j.status ?? 'fail',
          latency_ms: j.latency_ms ?? Date.now() - start,
          message: j.message ?? 'no message',
        };
      } catch (err) {
        return {
          kind: 'integration',
          name: row.display_name,
          status: 'fail',
          latency_ms: Date.now() - start,
          message: err instanceof Error ? err.message : 'unknown error',
        };
      }
    }),
  );

  // Critical paths — project-specific. Stub one example: "doc upload creates a run row".
  // Replace this with the actual critical paths for your app.
  const criticalChecks: CheckResult[] = [
    await criticalPathAuthRoundtrip(admin),
  ];

  const all = [...integrationChecks, ...criticalChecks];
  const summary = {
    ok: all.filter((c) => c.status === 'ok').length,
    fail: all.filter((c) => c.status === 'fail').length,
    warn: all.filter((c) => c.status === 'warn').length,
    disabled: all.filter((c) => c.status === 'disabled').length,
    total: all.length,
    ran_at: new Date().toISOString(),
  };

  // Persist summary + each check into integration_audits
  await admin.from('integration_audits').insert(
    all.map((c) => ({
      vendor: c.kind === 'integration' ? rows?.find((r) => r.display_name === c.name)?.vendor ?? null : null,
      check_name: c.kind === 'critical_path' ? `critical_path:${c.name}` : c.name,
      status: c.status === 'ok' ? 'ok' : c.status === 'warn' ? 'warn' : 'fail',
      latency_ms: c.latency_ms,
      message: c.message,
    })),
  );

  return NextResponse.json({summary, checks: all});
}

// Critical path stub — proves Supabase auth round-trip works.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function criticalPathAuthRoundtrip(admin: any): Promise<CheckResult> {
  const start = Date.now();
  const {error} = await admin.from('profiles').select('id').limit(1);
  if (error) {
    return {
      kind: 'critical_path',
      name: 'auth roundtrip',
      status: 'fail',
      latency_ms: Date.now() - start,
      message: error.message,
    };
  }
  return {
    kind: 'critical_path',
    name: 'auth roundtrip',
    status: 'ok',
    latency_ms: Date.now() - start,
    message: 'profiles table reachable',
  };
}
