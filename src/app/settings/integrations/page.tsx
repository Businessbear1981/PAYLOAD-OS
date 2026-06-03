import {createClient} from '@/lib/supabase/server';
import {redirect} from 'next/navigation';
import {IntegrationCard} from './integration-card';

export const dynamic = 'force-dynamic';

type IntegrationRow = {
  vendor: string;
  display_name: string;
  enabled: boolean;
  fields_schema: Array<{key: string; label: string; secret: boolean}>;
  last_tested_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
  last_test_latency_ms: number | null;
};

export default async function IntegrationsPage() {
  const supabase = await createClient();
  const {data: {user}} = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const {data: profile} = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile || !['admin', 'owner'].includes(profile.role)) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">403</h1>
        <p className="opacity-70">Only admins can manage integrations.</p>
      </main>
    );
  }

  const {data: integrations, error} = await supabase
    .from('integrations')
    .select('vendor, display_name, enabled, fields_schema, last_tested_at, last_test_status, last_test_message, last_test_latency_ms')
    .order('display_name');

  if (error) {
    return (
      <main className="p-8">
        <h1 className="text-2xl font-semibold">Settings → Integrations</h1>
        <p className="text-red-600">Failed to load: {error.message}</p>
        <p className="opacity-70 text-sm mt-2">
          If you haven&apos;t applied the <code>integrations</code> data engine yet:{' '}
          <code>supabase db push assets/data-engines/integrations.sql</code>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold mb-1">Integrations</h1>
      <p className="text-sm opacity-70 mb-6">
        Paste credentials. Toggle on/off. Test the connection. That&apos;s it.
      </p>
      <div className="grid gap-4">
        {(integrations as IntegrationRow[]).map((row) => (
          <IntegrationCard key={row.vendor} row={row} />
        ))}
      </div>
    </main>
  );
}
