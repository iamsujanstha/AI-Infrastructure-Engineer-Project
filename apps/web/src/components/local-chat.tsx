'use client';

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type ModelResponse = { models?: unknown; defaultModel?: unknown };
type CompletionResponse = {
  model?: unknown;
  content?: unknown;
  budget?: { promptTokenEstimate?: unknown; reservedOutputTokens?: unknown; contextWindowTokens?: unknown };
};

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');

function responseMessage(value: unknown, fallback: string): string {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}

export function LocalChat() {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [lastBudget, setLastBudget] = useState<CompletionResponse['budget']>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  const connect = useCallback(async () => {
    setError('');
    setConnecting(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/chat/models`, { cache: 'no-store' });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(body, 'Could not reach the local chat API.'));
      const result = body as ModelResponse;
      if (!Array.isArray(result.models) || !result.models.every((item) => typeof item === 'string')) {
        throw new Error('The API returned an invalid model list.');
      }
      setModels(result.models);
      setModel(typeof result.defaultModel === 'string' ? result.defaultModel : (result.models[0] ?? ''));
      setConnected(true);
      setMessages([]);
      setLastBudget(undefined);
    } catch (cause) {
      setConnected(false);
      setError(cause instanceof Error ? cause.message : 'Connection failed.');
    } finally {
      setConnecting(false);
    }
  }, []);

  useEffect(() => { void connect(); }, [connect]);

  async function send(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = draft.trim();
    if (!connected || !content || busy || !model) return;
    setError('');
    setDraft('');
    setBusy(true);
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content }];
    try {
      const response = await fetch(`${API_BASE}/api/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages: nextMessages }),
        cache: 'no-store',
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(body, 'The local model request failed.'));
      const result = body as CompletionResponse;
      if (typeof result.content !== 'string' || typeof result.model !== 'string') throw new Error('The API returned an invalid completion.');
      setMessages([...nextMessages, { role: 'assistant', content: result.content }]);
      setLastBudget(result.budget);
    } catch (cause) {
      setDraft(content);
      setError(cause instanceof Error ? cause.message : 'The local model request failed.');
    } finally {
      setBusy(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-5 md:px-8">
      <header className="flex items-center justify-between border-b border-[var(--border)] pb-4">
        <a href="/" className="flex items-center gap-3 no-underline">
          <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl border border-emerald-200/20 bg-emerald-200/10 text-emerald-100">◈</span>
          <span><span className="block text-sm font-semibold">Project Context AI</span><span className="block text-xs text-[var(--muted)]">Local model workspace</span></span>
        </a>
        <nav className="flex items-center gap-4 text-sm">
          <span className={`hidden items-center gap-2 sm:flex ${connected ? 'text-emerald-200' : 'text-[var(--muted)]'}`}><i className={`size-2 rounded-full ${connected ? 'bg-emerald-300' : 'bg-zinc-500'}`} />{connected ? 'Ready' : connecting ? 'Connecting' : 'Unavailable'}</span>
          <a className="text-[var(--muted)] hover:text-[var(--foreground)]" href="/system">System</a>
          {!connected && !connecting && <button className="text-[var(--muted)] hover:text-[var(--foreground)]" onClick={() => void connect()}>Retry</button>}
        </nav>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        {!connected ? (
          <div className="my-auto py-12">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200/80">Private · local inference</p>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">A conversation with your local model.</h1>
            <div className="mt-9 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
              <p className="text-sm font-medium">{connecting ? 'Connecting to your local model…' : 'Local model unavailable'}</p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Model choices come from the running inference server. The API accepts this chat only from the configured local web origin.</p>
              {error && <p role="alert" className="mt-4 text-sm text-amber-200">{error}</p>}
              {!connecting && <button className="mt-4 rounded-xl bg-emerald-200 px-5 py-3 font-semibold text-[#102017]" onClick={() => void connect()}>Retry connection</button>}
            </div>
            <p className="mt-5 text-xs leading-5 text-[var(--muted)]">Project files and repositories are not connected yet. Replies use only this conversation and the selected model.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] py-4">
              <label className="flex items-center gap-3 text-sm text-[var(--muted)]">Model
                <select value={model} onChange={(event) => setModel(event.target.value)} disabled={busy} className="max-w-64 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)]">
                  {models.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <button onClick={() => { setMessages([]); setLastBudget(undefined); setError(''); }} disabled={busy || messages.length === 0} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40">New chat</button>
            </div>
            <div className="flex-1 py-6" aria-live="polite">
              {models.length === 0 && <p role="alert" className="rounded-xl border border-amber-200/20 bg-amber-100/5 p-4 text-sm text-amber-100">The configured inference provider returned no available models.</p>}
              {messages.length === 0 && !busy ? (
                <div className="grid min-h-[45vh] place-items-center text-center">
                  <div><p className="text-2xl font-medium">What would you like to work through?</p><p className="mt-3 text-sm text-[var(--muted)]">This chat is held in the current tab and is not persisted.</p></div>
                </div>
              ) : <div className="space-y-6">{messages.map((message, index) => <article key={`${index}-${message.role}`} className={`flex gap-4 ${message.role === 'user' ? 'justify-end' : ''}`}><div className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-5 py-4 leading-7 ${message.role === 'user' ? 'bg-[#25342c]' : 'border border-[var(--border)] bg-[var(--surface)]'}`}><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">{message.role === 'user' ? 'You' : model}</p>{message.content}</div></article>)}{busy && <p className="text-sm text-[var(--muted)]" role="status">Waiting for local inference…</p>}</div>}
              <div ref={endRef} />
            </div>
            <form onSubmit={(event) => void send(event)} className="mb-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 focus-within:border-emerald-200/40">
              <textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} placeholder="Message the local model…" disabled={busy} className="block w-full resize-y bg-transparent px-2 py-2 leading-6 outline-none placeholder:text-[var(--muted)]" />
              <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                <span className="text-xs text-[var(--muted)]">Enter to send · Shift+Enter for a new line</span>
                <button disabled={busy || !draft.trim()} className="rounded-lg bg-emerald-200 px-4 py-2 text-sm font-semibold text-[#102017] disabled:opacity-40">{busy ? 'Generating…' : 'Send'}</button>
              </div>
            </form>
            {error && <p role="alert" className="mb-3 text-sm text-amber-200">{error}</p>}
            {lastBudget && typeof lastBudget.promptTokenEstimate === 'number' && typeof lastBudget.contextWindowTokens === 'number' && <p className="mb-3 text-center text-xs text-[var(--muted)]">Prompt size estimate: {lastBudget.promptTokenEstimate.toLocaleString()} / {lastBudget.contextWindowTokens.toLocaleString()} · UTF-8 byte estimate, not provider-reported token usage</p>}
            <p className="mb-5 text-center text-xs text-[var(--muted)]">No project context is attached. Conversation exists only in this tab.</p>
          </>
        )}
      </section>
      <footer className="border-t border-[var(--border)] py-4 text-center text-xs text-[var(--muted)]">Local development · loopback API · no conversation persistence</footer>
    </main>
  );
}
