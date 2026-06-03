import {NextResponse, type NextRequest} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {createClient as createAdmin} from '@supabase/supabase-js';
import {encryptJson} from '@/lib/crypto';
import {invalidateConfig} from '@/lib/config';

export const runtime = 'nodejs';

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {auth: {persistSession: false}},
  );
}

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

// PUT — save credentials + enabled flag for a vendor.
// Body: {credentials: Record<string,string>, enabled: boolean}
export async function PUT(req: NextRequest, ctx: {params: Promise<{vendor: string}>}) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({error: 'forbidden'}, {status: 403});

  const {vendor} = await ctx.params;
  const {credentials, enabled} = (await req.json()) as {
    credentials?: Record<string, string>;
    enabled?: boolean;
  };

  const update: Record<string, unknown> = {};
  if (typeof enabled === 'boolean') update.enabled = enabled;
  if (credentials && Object.keys(credentials).length > 0) {
    const {ciphertext, iv} = encryptJson(credentials);
    update.ciphertext = ciphertext;
    update.iv = iv;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({error: 'nothing to update'}, {status: 400});
  }

  const {error} = await admin().from('integrations').update(update).eq('vendor', vendor);
  if (error) return NextResponse.json({error: error.message}, {status: 500});

  invalidateConfig(vendor);
  return NextResponse.json({ok: true});
}
