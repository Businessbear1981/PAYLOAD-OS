import {NextResponse, type NextRequest} from 'next/server';
import {createClient} from '@supabase/supabase-js';

// Generic media-vendor webhook receiver.
//
// Accepts callbacks from Higgsfield / Suno / Meshy when a generation job
// finishes. Pass ?vendor=higgsfield (or suno|meshy) on the URL when configuring
// the webhook in the vendor dashboard. The handler updates the media_assets
// row keyed by the vendor's job id (stored as `metadata.vendor_job_id`).

export const runtime = 'nodejs';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {auth: {persistSession: false}},
);

type Vendor = 'higgsfield' | 'suno' | 'meshy';

export async function POST(req: NextRequest) {
  const vendor = (req.nextUrl.searchParams.get('vendor') ?? '') as Vendor;
  if (!['higgsfield', 'suno', 'meshy'].includes(vendor)) {
    return NextResponse.json({error: 'unknown vendor'}, {status: 400});
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON'}, {status: 400});
  }

  // Each vendor's payload shape differs — pull the job id + result URL based on
  // vendor. Adjust these field paths as vendor schemas evolve.
  const jobId =
    (payload.id as string | undefined) ??
    (payload.job_id as string | undefined) ??
    (payload.task_id as string | undefined);

  const status =
    (payload.status as string | undefined)?.toLowerCase() ?? 'unknown';

  if (!jobId) {
    return NextResponse.json({error: 'missing job id'}, {status: 400});
  }

  // Mark the corresponding media_assets row as uploaded (or failed)
  const isDone = ['complete', 'succeeded', 'finished'].includes(status);
  const isFailed = ['failed', 'error'].includes(status);

  const {error} = await admin
    .from('media_assets')
    .update({
      status: isDone ? 'uploaded' : isFailed ? 'failed' : 'uploading',
      metadata: payload,
    })
    .contains('metadata', {vendor_job_id: jobId});

  if (error) {
    return NextResponse.json({error: error.message}, {status: 500});
  }

  return NextResponse.json({received: true, vendor, jobId, status});
}
