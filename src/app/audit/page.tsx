'use client';

import {useEffect, useState} from 'react';

type CheckResult = {
  kind: 'integration' | 'webhook' | 'critical_path';
  name: string;
  status: 'ok' | 'fail' | 'warn' | 'disabled';
  latency_ms: number;
  message: string;
};

type AuditResponse = {
  summary: {ok: number; fail: number; warn: number; disabled: number; total: number; ran_at: string};
  checks: CheckResult[];
};

export default function AuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setErr(null);
    try {
      const res = await fetch('/api/audit', {method: 'POST'});
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dot = (s: CheckResult['status']) =>
    s === 'ok' ? 'bg-green-500' :
    s === 'fail' ? 'bg-red-500' :
    s === 'warn' ? 'bg-yellow-500' :
    s === 'disabled' ? 'bg-zinc-400' : 'bg-zinc-300';

  const grouped = (kind: CheckResult['kind']) => data?.checks.filter((c) => c.kind === kind) ?? [];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">End-to-end audit</h1>
        <button
          onClick={run}
          disabled={running}
          className="rounded bg-black text-white px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {running ? 'Running…' : 'Run again'}
        </button>
      </header>

      {err && <p className="text-red-600 text-sm mb-4">{err}</p>}

      {data && (
        <p className="text-xs opacity-60 mb-4">
          ran {new Date(data.summary.ran_at).toLocaleString()} ·{' '}
          <span className="text-green-700">{data.summary.ok} ok</span>{' / '}
          <span className="text-red-700">{data.summary.fail} fail</span>{' / '}
          <span className="text-yellow-700">{data.summary.warn} warn</span>{' / '}
          <span>{data.summary.disabled} disabled</span>
        </p>
      )}

      {(['integration', 'critical_path', 'webhook'] as const).map((kind) => {
        const rows = grouped(kind);
        if (!data || rows.length === 0) return null;
        return (
          <section key={kind} className="mb-6">
            <h2 className="text-sm font-semibold uppercase opacity-60 mb-2">
              {kind === 'integration' ? 'Integrations' : kind === 'critical_path' ? 'Critical paths' : 'Webhooks'}
            </h2>
            <div className="grid gap-1">
              {rows.map((c) => (
                <div key={c.name} className="flex items-center justify-between rounded border p-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot(c.status)}`} />
                    <span className="font-medium">{c.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs opacity-70">
                    <span>{c.message}</span>
                    <span className="opacity-50">{c.latency_ms}ms</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {!data && !err && <p className="opacity-60 text-sm">Running first audit…</p>}
    </main>
  );
}
