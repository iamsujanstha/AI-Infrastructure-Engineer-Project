'use client';

import { useCallback, useEffect, useState } from 'react';

type DependencyName = 'API' | 'PostgreSQL' | 'Redis' | 'Inference';
type DependencyStatus = 'checking' | 'online' | 'offline' | 'not_configured';
type Dependency = { name: DependencyName; path: string; status: DependencyStatus; detail: string };

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000';
const initialDependencies: Dependency[] = [
  { name: 'API', path: '/health', status: 'checking', detail: 'Checking process liveness' },
  { name: 'PostgreSQL', path: '/health/database', status: 'checking', detail: 'Checking database readiness' },
  { name: 'Redis', path: '/health/redis', status: 'checking', detail: 'Checking Redis readiness' },
  { name: 'Inference', path: '/health/inference', status: 'checking', detail: 'Checking configured inference endpoint' },
];

function statusStyle(status: DependencyStatus): string {
  if (status === 'online') return 'border-emerald-300/20 bg-emerald-300/10 text-emerald-200';
  if (status === 'checking') return 'border-sky-300/20 bg-sky-300/10 text-sky-200';
  return 'border-amber-300/20 bg-amber-300/10 text-amber-200';
}

export function SystemHealth() {
  const [dependencies, setDependencies] = useState(initialDependencies);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const results = await Promise.all(initialDependencies.map(async (dependency): Promise<Dependency> => {
      try {
        const response = await fetch(`${apiBase}${dependency.path}`, { cache: 'no-store', signal });
        const payload: unknown = await response.json();
        if (response.ok) return { ...dependency, status: 'online', detail: 'Responding' };
        if (typeof payload === 'object' && payload !== null && 'status' in payload &&
          payload.status === 'not_configured') {
          return { ...dependency, status: 'not_configured', detail: 'No health endpoint configured' };
        }
        return { ...dependency, status: 'offline', detail: `Unavailable · HTTP ${response.status}` };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return dependency;
        return { ...dependency, status: 'offline', detail: 'API unreachable' };
      }
    }));
    if (!signal?.aborted) {
      setDependencies(results);
      setLastChecked(new Date().toLocaleTimeString());
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  return (
    <section aria-labelledby="health-heading">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 id="health-heading" className="text-xl font-semibold">System health</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">Service checks avoid returning connection details or credentials.</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm transition hover:border-emerald-200/50 disabled:cursor-wait disabled:opacity-50"
        >
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {dependencies.map((dependency) => (
          <article key={dependency.name} className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div>
              <h3 className="font-medium">{dependency.name}</h3>
              <p className="mt-1 text-sm text-[var(--muted)]">{dependency.detail}</p>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${statusStyle(dependency.status)}`}>
              {dependency.status.replace('_', ' ')}
            </span>
          </article>
        ))}
      </div>
      <p aria-live="polite" className="mt-3 min-h-5 text-xs text-[var(--muted)]">
        {lastChecked ? `Last checked ${lastChecked}` : 'Waiting for first health check'}
      </p>
    </section>
  );
}
