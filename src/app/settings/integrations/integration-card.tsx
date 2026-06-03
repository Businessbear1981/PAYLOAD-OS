'use client';

import {useState, useTransition} from 'react';

type Field = {key: string; label: string; secret: boolean};

type Row = {
  vendor: string;
  display_name: string;
  enabled: boolean;
  fields_schema: Field[];
  last_tested_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
  last_test_latency_ms: number | null;
};

export function IntegrationCard({row}: {row: Row}) {
  const [enabled, setEnabled] = useState(row.enabled);
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string | null>(row.last_test_status);
  const [message, setMessage] = useState<string | null>(row.last_test_message);
  const [latency, setLatency] = useState<number | null>(row.last_test_latency_ms);
  const [pending, startTransition] = useTransition();

  const filledValues = () =>
    Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim().length > 0));

  const save = () =>
    startTransition(async () => {
      const res = await fetch(`/api/integrations/${row.vendor}`, {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({credentials: filledValues(), enabled}),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setStatus('fail');
        setMessage(err.error ?? `save failed (${res.status})`);
      } else {
        setMessage('saved');
      }
    });

  const test = () =>
    startTransition(async () => {
      const res = await fetch(`/api/integrations/${row.vendor}/test`, {method: 'POST'});
      const j = await res.json();
      setStatus(j.status);
      setMessage(j.message);
      setLatency(j.latency_ms ?? null);
    });

  const dot =
    status === 'ok' ? 'bg-green-500' :
    status === 'fail' ? 'bg-red-500' :
    status === 'no_quota' ? 'bg-yellow-500' :
    status === 'disabled' ? 'bg-zinc-400' :
    'bg-zinc-300';

  return (
    <section className="rounded-lg border p-4">
      <header className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} />
          <h2 className="font-medium">{row.display_name}</h2>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled
        </label>
      </header>

      <div className="grid gap-2 mb-3">
        {row.fields_schema.map((f) => (
          <label key={f.key} className="grid gap-1">
            <span className="text-xs opacity-70">{f.label}</span>
            <input
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={f.secret ? '••••••••' : ''}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({...v, [f.key]: e.target.value}))}
              className="rounded border px-2 py-1.5 text-sm"
            />
          </label>
        ))}
      </div>

      {message && (
        <p className="text-xs mb-2 opacity-80">
          {message}
          {latency != null && <span className="opacity-50"> · {latency}ms</span>}
        </p>
      )}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded bg-black text-white px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {pending ? '…' : 'Save'}
        </button>
        <button
          onClick={test}
          disabled={pending}
          className="rounded border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Test
        </button>
      </div>
    </section>
  );
}
