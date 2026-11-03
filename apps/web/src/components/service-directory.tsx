'use client';

import { useCallback, useEffect, useState } from 'react';

type ServiceLinkSet = { home: string | null; docs: string | null; api: string | null };
type ServiceConnection = {
  host: string;
  port: number;
  database: string | null;
  username: string | null;
  passwordEnvironmentVariable: string | null;
};
type ServiceLogin = {
  username: string;
  passwordEnvironmentVariable: string;
  passwordConfiguration: string;
};
type LocalService = {
  id: string;
  name: string;
  type: string;
  description: string;
  links: ServiceLinkSet;
  connection: ServiceConnection | null;
  login: ServiceLogin | null;
  launchCommand: string | null;
};
type DirectoryResponse = { scope: string; note: string; services: LocalService[] };

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isService(value: unknown): value is LocalService {
  if (!isRecord(value) || !isRecord(value.links)) return false;
  const links = value.links;
  const connection = value.connection;
  const login = value.login;
  const connectionValid = connection === null || (isRecord(connection)
    && typeof connection.host === 'string' && typeof connection.port === 'number'
    && isNullableString(connection.database) && isNullableString(connection.username)
    && isNullableString(connection.passwordEnvironmentVariable));
  const loginValid = login === null || (isRecord(login) && typeof login.username === 'string'
    && typeof login.passwordEnvironmentVariable === 'string' && typeof login.passwordConfiguration === 'string');
  return typeof value.id === 'string' && typeof value.name === 'string' && typeof value.type === 'string'
    && typeof value.description === 'string' && (safeAddress(links.home as string | null) || links.home === null)
    && (safeAddress(links.docs as string | null) || links.docs === null)
    && (safeAddress(links.api as string | null) || links.api === null)
    && connectionValid && loginValid && (typeof value.launchCommand === 'string' || value.launchCommand === null);
}

function isDirectory(value: unknown): value is DirectoryResponse {
  return isRecord(value) && value.scope === 'local_development' && typeof value.note === 'string'
    && Array.isArray(value.services) && value.services.every(isService);
}

function safeAddress(value: string | null): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function ServiceDirectory() {
  const [directory, setDirectory] = useState<DirectoryResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState('');

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/v1/system/services`, { cache: 'no-store', signal });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Service directory could not be loaded · HTTP ${response.status}`);
      if (!isDirectory(payload)) throw new Error('The API returned an invalid service directory.');
      if (!signal?.aborted) setDirectory(payload);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : 'Could not reach the local API.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const copy = useCallback(async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(''), 1400);
    } catch {
      setCopied('Copy unavailable');
      window.setTimeout(() => setCopied(''), 1800);
    }
  }, []);

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-5 md:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <a href="/" className="flex items-center gap-3 no-underline">
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl border border-emerald-200/20 bg-emerald-200/10 text-emerald-100">◈</span>
          <span><span className="block text-sm font-semibold">Project Context AI</span><span className="block text-xs text-[var(--muted)]">Local service directory</span></span>
        </a>
        <nav aria-label="Main navigation" className="flex items-center gap-4 text-sm">
          <a className="text-[var(--muted)] hover:text-[var(--foreground)]" href="/">Chat</a>
          <a className="text-[var(--muted)] hover:text-[var(--foreground)]" href="/system">System</a>
          <a className="text-[var(--muted)] hover:text-[var(--foreground)]" href={`${API_BASE}/docs`} target="_blank" rel="noreferrer">API docs ↗</a>
        </nav>
      </header>

      <section className="mx-auto max-w-5xl py-10 md:py-14">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200/80">Developer workspace</p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">Local services</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">Open a service, inspect its API, or copy the connection settings you need.</p>
          </div>
          <div className="flex items-center gap-3">
            <a className="text-xs text-[var(--muted)] underline decoration-[var(--border)] underline-offset-4 hover:text-[var(--foreground)]" href={`${API_BASE}/api/v1/system/services`} target="_blank" rel="noreferrer">View JSON</a>
            <button type="button" onClick={() => void load()} disabled={loading} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm transition hover:border-emerald-200/50 disabled:cursor-wait disabled:opacity-50">{loading ? 'Loading…' : 'Refresh'}</button>
          </div>
        </div>

        {directory && <p className="mt-6 rounded-xl border border-sky-200/10 bg-sky-200/[0.04] px-4 py-3 text-xs leading-5 text-[var(--muted)]">{directory.note}</p>}

        {error && (
          <div role="alert" className="mt-8 rounded-2xl border border-amber-200/20 bg-amber-100/[0.04] p-5">
            <p className="font-medium text-amber-100">Service directory unavailable</p>
            <p className="mt-2 text-sm text-[var(--muted)]">{error}. Start the NestJS API, then retry.</p>
            <button type="button" onClick={() => void load()} className="mt-4 rounded-lg bg-emerald-200 px-4 py-2 text-sm font-semibold text-[#102017]">Retry connection</button>
          </div>
        )}

        {loading && !directory && <div className="mt-8 grid gap-4 md:grid-cols-2" aria-label="Loading services">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-48 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface)]" />)}</div>}

        {directory && (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {directory.services.map((service) => (
              <article key={service.id} className="flex min-h-52 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-emerald-200/30">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{service.name}</h2>
                    <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{service.description}</p>
                  </div>
                  <span className="shrink-0 rounded-full border border-[var(--border)] px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">{service.type.replaceAll('_', ' ')}</span>
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  {safeAddress(service.links.home) && <a className="rounded-lg bg-emerald-200 px-3 py-2 text-xs font-semibold text-[#102017] hover:bg-emerald-100" href={service.links.home} target="_blank" rel="noreferrer">Open service ↗</a>}
                  {safeAddress(service.links.docs) && <a className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium hover:border-emerald-200/40" href={service.links.docs} target="_blank" rel="noreferrer">Open docs ↗</a>}
                  {safeAddress(service.links.api) && <a className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium hover:border-emerald-200/40" href={service.links.api} target="_blank" rel="noreferrer">Open API ↗</a>}
                  {service.links.home === null && service.connection && <p className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">TCP connection · no browser UI</p>}
                  {service.type === 'stdio_mcp' && <p className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">Local process · no web page</p>}
                </div>

                {service.connection && (
                  <div className="mt-5 space-y-2 border-t border-[var(--border)] pt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Connection details</p>
                    <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <Detail label="Host" value={service.connection.host} copy={copy} copied={copied} />
                      <Detail label="Port" value={String(service.connection.port)} copy={copy} copied={copied} />
                      {service.connection.database && <Detail label="Database" value={service.connection.database} copy={copy} copied={copied} />}
                      {service.connection.username && <Detail label="User" value={service.connection.username} copy={copy} copied={copied} />}
                    </div>
                    {service.connection.passwordEnvironmentVariable && <p className="text-xs text-[var(--muted)]">Password: use local <code className="rounded bg-black/20 px-1.5 py-0.5 text-emerald-100">{service.connection.passwordEnvironmentVariable}</code>. The value is intentionally not shown here.</p>}
                  </div>
                )}

                {service.login && (
                  <div className="mt-5 space-y-2 border-t border-[var(--border)] pt-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Sign in</p>
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-black/10 px-3 py-2">
                      <div><p className="text-[10px] text-[var(--muted)]">Email</p><p className="mt-0.5 font-mono text-xs">{service.login.username}</p></div>
                      <CopyButton label={`email-${service.id}`} value={service.login.username} copy={copy} copied={copied} />
                    </div>
                    <p className="text-xs leading-5 text-[var(--muted)]">Password is set by <code className="rounded bg-black/20 px-1.5 py-0.5 text-emerald-100">{service.login.passwordEnvironmentVariable}</code>. {service.login.passwordConfiguration}</p>
                  </div>
                )}

                {service.launchCommand && (
                  <div className="mt-auto border-t border-[var(--border)] pt-4">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Start locally</p>
                    <div className="flex items-start justify-between gap-2 rounded-xl bg-[#0d100f] px-3 py-2.5">
                      <code className="min-w-0 break-all text-xs leading-5 text-emerald-100">{service.launchCommand}</code>
                      <CopyButton label={`command-${service.id}`} value={service.launchCommand} copy={copy} copied={copied} />
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

        <p aria-live="polite" className="mt-6 min-h-5 text-center text-xs text-[var(--muted)]">{copied && copied !== 'Copy unavailable' ? 'Copied to clipboard' : copied}</p>
      </section>
      <footer className="border-t border-[var(--border)] py-4 text-center text-xs text-[var(--muted)]">Local development · configured links only · no passwords or health claims</footer>
    </main>
  );
}

function Detail({ label, value, copy, copied }: { label: string; value: string; copy: (label: string, value: string) => Promise<void>; copied: string }) {
  const key = `${label}-${value}`;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-black/10 px-3 py-2">
      <p className="text-[10px] text-[var(--muted)]">{label}</p>
      <div className="mt-0.5 flex items-center justify-between gap-1">
        <code className="break-all text-xs">{value}</code>
        <button type="button" aria-label={`Copy ${label}`} onClick={() => void copy(key, value)} className="shrink-0 rounded px-1.5 py-1 text-[10px] text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)]">{copied === key ? '✓' : 'Copy'}</button>
      </div>
    </div>
  );
}

function CopyButton({ label, value, copy, copied }: { label: string; value: string; copy: (label: string, value: string) => Promise<void>; copied: string }) {
  return <button type="button" onClick={() => void copy(label, value)} className="shrink-0 rounded px-2 py-1 text-[10px] text-[var(--muted)] hover:bg-white/5 hover:text-[var(--foreground)]">{copied === label ? 'Copied' : 'Copy'}</button>;
}
