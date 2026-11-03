import { SystemHealth } from '../../components/system-health';

export default function SystemPage() {
  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-10">
      <nav aria-label="Main navigation" className="flex gap-4 text-sm">
        <a className="text-[var(--accent)]" href="/">Chat</a>
        <a className="text-[var(--accent)]" href="/services">Services</a>
      </nav>
      <h1 className="mt-8 text-3xl font-semibold">System diagnostics</h1>
      <p className="mt-2 mb-8 text-[var(--muted)]">Live process and dependency checks.</p>
      <SystemHealth />
    </main>
  );
}
