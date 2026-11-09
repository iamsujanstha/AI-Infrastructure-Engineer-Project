'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { parseContextAnswer, type ContextAnswer } from './supplied-context-response';

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

function errorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string') return value.message;
  return fallback;
}

export function SuppliedContextChat() {
  const [context, setContext] = useState('');
  const [question, setQuestion] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState<ContextAnswer | null>(null);
  const [attempt, setAttempt] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadModels(): Promise<void> {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`${API_BASE}/api/v1/chat/models`, { cache: 'no-store', signal: controller.signal });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(errorMessage(body, 'Could not reach the local model provider.'));
        if (typeof body !== 'object' || body === null || !('models' in body)
            || !Array.isArray(body.models) || !body.models.every((item: unknown) => typeof item === 'string')) {
          throw new Error('The API returned an invalid model list.');
        }
        const available = body.models as string[];
        setModels(available);
        const preferred = 'defaultModel' in body ? body.defaultModel : undefined;
        setModel(typeof preferred === 'string' && available.includes(preferred) ? preferred : (available[0] ?? ''));
        if (!available.length) setError('No models are available from the configured local provider.');
      } catch (cause) {
        if (!controller.signal.aborted) {
          setModels([]);
          setModel('');
          setError(cause instanceof Error ? cause.message : 'Could not load available models.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void loadModels();
    return () => { controller.abort(); activeRequest.current?.abort(); };
  }, [attempt]);

  async function ask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !model || !question.trim() || !context.trim()) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    setError('');
    setAnswer(null);
    try {
      const response = await fetch(`${API_BASE}/api/v1/chat/context-answers`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store', signal: controller.signal,
        body: JSON.stringify({ model, question, context }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(errorMessage(body, 'The context request failed. No answer was accepted.'));
      setAnswer(parseContextAnswer(body));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The context request failed.');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      activeRequest.current = null;
    }
  }

  function clear(): void {
    setContext(''); setQuestion(''); setAnswer(null); setError('');
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-5 py-8 md:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-5">
        <div><p className="text-sm font-semibold text-emerald-200">Project Context AI</p><h1 className="mt-2 text-3xl font-semibold">Ask from your reference text</h1></div>
        <nav aria-label="Local services" className="flex gap-4 text-sm text-[var(--muted)]"><a href="/services">Services</a><a href="/system">System</a></nav>
      </header>
      <p className="mt-5 text-sm leading-6 text-[var(--muted)]">Paste text you are authorized to use, then ask a question. Answers show exact source passages. General knowledge and saved chat history are not used as answer text.</p>
      <p className="mt-2 text-xs leading-5 text-[var(--muted)]">This is a single-user local prototype, not an organization login. Use non-sensitive text; automatic secret screening is incomplete. No company documents are connected.</p>

      <form onSubmit={(event) => void ask(event)} className="mt-7 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor="context-model" className="flex items-center gap-3 text-sm">Local model
            <select id="context-model" value={model} onChange={(event) => { setModel(event.target.value); setAnswer(null); }} disabled={busy || loading || !models.length} className="max-w-72 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
              {!models.length && <option value="">{loading ? 'Loading models…' : 'No model available'}</option>}
              {models.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {!loading && !models.length && <button type="button" onClick={() => setAttempt((current) => current + 1)} className="text-sm text-emerald-200">Retry model connection</button>}
          <button type="button" onClick={clear} disabled={busy} className="text-sm text-[var(--muted)] disabled:opacity-40">Clear reference and answer</button>
        </div>
        <div>
          <label htmlFor="reference-text" className="block text-sm font-medium">Reference text</label>
          <textarea id="reference-text" value={context} onChange={(event) => { setContext(event.target.value); setAnswer(null); }} disabled={busy} rows={12} maxLength={24000} required aria-describedby="reference-help" placeholder="Paste approved policy or project text here. Separate sections with blank lines." className="mt-2 block w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 leading-6 outline-none focus:border-emerald-200/50" />
          <p id="reference-help" className="mt-2 text-xs leading-5 text-[var(--muted)]">{context.length.toLocaleString()} / 24,000 characters · A smaller reference may be needed for the model budget. Text is not saved by this feature; clearing or leaving this mode removes it from the form.</p>
        </div>
        <div>
          <label htmlFor="context-question" className="block text-sm font-medium">Question about this reference</label>
          <textarea id="context-question" value={question} onChange={(event) => { setQuestion(event.target.value); setAnswer(null); }} disabled={busy} rows={3} maxLength={2000} required placeholder="What does this text say about…?" className="mt-2 block w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 outline-none focus:border-emerald-200/50" />
        </div>
        <button disabled={busy || loading || !model || !context.trim() || !question.trim()} className="rounded-xl bg-emerald-200 px-5 py-3 text-sm font-semibold text-[#102017] disabled:opacity-40">{busy ? 'Selecting source passages…' : 'Ask using this reference'}</button>
      </form>
      {busy && <p role="status" className="mt-4 text-sm text-[var(--muted)]">Waiting for the local model. Source text and the question are sent with this request only.</p>}
      {error && <p role="alert" className="mt-5 rounded-xl border border-amber-200/20 p-4 text-sm text-amber-100">{error}</p>}
      {answer && <section aria-label="Context answer" aria-live="polite" className="mt-8 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-lg font-semibold">{answer.status === 'not_found' ? 'No supporting passage selected' : 'Selected source passages'}</h2>
        {answer.status === 'not_found' ? <p className="mt-4">{answer.content}</p> : <>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Verbatim extracts, not a generated summary. Check that they answer your question and include applicable exceptions; model selection can be wrong or incomplete.</p>
          {answer.sources.map((source) => <article key={source.id} className="mt-5 border-t border-[var(--border)] pt-4">
            <h3 className="text-sm font-medium text-emerald-200">{source.id} · Reference lines {source.lineStart}–{source.lineEnd}</h3>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7">{source.text}</p>
          </article>)}
        </>}
        <p className="mt-5 text-xs leading-5 text-[var(--muted)]">Model: {answer.model} · Prompt estimate: {answer.budget.promptTokenEstimate.toLocaleString()} / {answer.budget.contextWindowTokens.toLocaleString()} · UTF-8 byte estimate, not actual token usage.</p>
      </section>}
      <footer className="mt-10 border-t border-[var(--border)] pt-5 text-xs leading-5 text-[var(--muted)]">No repository retrieval, web search, tools, Hermes memory, or conversation persistence is used in this mode. Pasted text remains untrusted source material.</footer>
    </main>
  );
}
