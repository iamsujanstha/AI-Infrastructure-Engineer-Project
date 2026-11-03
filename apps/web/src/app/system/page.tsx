import { SystemHealth } from '../../components/system-health';

export default function SystemPage() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <a className="text-sm text-[var(--accent)]" href="/">← Back to chat</a>
      <h1 className="mt-8 text-3xl font-semibold">System diagnostics</h1>
      <p className="mt-2 mb-8 text-[var(--muted)]">Live process and dependency checks.</p>
      <SystemHealth />
    </main>
  );
}
