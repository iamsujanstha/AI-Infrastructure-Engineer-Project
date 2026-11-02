import { SystemHealth } from '../components/system-health';

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-8 md:px-10 md:py-12">
      <header className="flex items-center justify-between border-b border-[var(--border)] pb-6">
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="grid size-10 place-items-center rounded-xl border border-emerald-200/20 bg-emerald-200/10 text-emerald-100">◈</div>
          <div>
            <p className="text-sm font-semibold tracking-wide">LOCAL AI PLATFORM</p>
            <p className="mt-1 text-xs text-[var(--muted)]">Infrastructure control plane</p>
          </div>
        </div>
        <span className="rounded-full border border-[var(--border)] px-3 py-1 text-xs text-[var(--muted)]">Phase 1 · Foundation</span>
      </header>

      <section className="grid gap-10 py-12 md:grid-cols-[1fr_300px] md:items-end">
        <div>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200/80">Private AI systems</p>
          <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight md:text-5xl">Know what the system can reach.</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[var(--muted)]">
            A compact control surface for the services behind your agent. Liveness and dependency readiness are reported separately.
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <p className="text-xs uppercase tracking-widest text-[var(--muted)]">Current milestone</p>
          <p className="mt-3 text-lg font-medium">Foundation services</p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Database and job infrastructure are checked independently from API process health.</p>
        </div>
      </section>

      <SystemHealth />

      <footer className="mt-12 flex flex-wrap justify-between gap-3 border-t border-[var(--border)] py-5 text-xs text-[var(--muted)]">
        <span>Persistent knowledge will remain distinct from each bounded inference context.</span>
        <span>Local development · localhost only</span>
      </footer>
    </main>
  );
}
