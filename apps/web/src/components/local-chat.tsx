'use client';

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AssistantMarkdown } from './assistant-markdown';

type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; status: string };
type Conversation = { id: string; title: string; lastMessageAt: string };
type ModelResponse = { models?: unknown; defaultModel?: unknown };
type MessageResponse = { id: string; role: string; content: string; status: string };
type MessageListResponse = { messages?: unknown };
type ConversationListResponse = { conversations?: unknown };
type TurnResponse = { assistantMessage?: unknown; budget?: { promptTokenEstimate?: unknown; contextWindowTokens?: unknown } };

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
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState('');
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [lastBudget, setLastBudget] = useState<TurnResponse['budget']>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  const connect = useCallback(async () => {
    setError('');
    setConnecting(true);
    try {
      let inferenceError = '';
      try {
        const response = await fetch(`${API_BASE}/api/v1/chat/models`, { cache: 'no-store' });
        const body: unknown = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(responseMessage(body, 'Could not reach the local inference server.'));
        const result = body as ModelResponse;
        if (!Array.isArray(result.models) || !result.models.every((item) => typeof item === 'string')) {
          throw new Error('The API returned an invalid model list.');
        }
        setModels(result.models);
        setModel(typeof result.defaultModel === 'string' ? result.defaultModel : (result.models[0] ?? ''));
        if (result.models.length === 0) inferenceError = 'The configured inference provider returned no available models.';
      } catch (cause) {
        setModels([]);
        setModel('');
        inferenceError = cause instanceof Error ? cause.message : 'Could not reach the local inference server.';
      }
      const listResponse = await fetch(`${API_BASE}/api/v1/chat/conversations`, { cache: 'no-store' });
      const listBody: unknown = await listResponse.json().catch(() => ({}));
      if (!listResponse.ok) throw new Error(responseMessage(listBody, 'Could not load saved conversations.'));
      const list = listBody as ConversationListResponse;
      if (!Array.isArray(list.conversations)) throw new Error('The API returned an invalid conversation list.');
      let available = list.conversations as Conversation[];
      if (available.length === 0) {
        const createResponse = await fetch(`${API_BASE}/api/v1/chat/conversations`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
        });
        const createBody: unknown = await createResponse.json().catch(() => ({}));
        if (!createResponse.ok) throw new Error(responseMessage(createBody, 'Could not start a conversation.'));
        available = [createBody as Conversation];
      }
      setConversations(available);
      const active = available[0]!;
      setConversationId(active.id);
      const historyResponse = await fetch(`${API_BASE}/api/v1/chat/conversations/${active.id}/messages`, { cache: 'no-store' });
      const historyBody: unknown = await historyResponse.json().catch(() => ({}));
      if (!historyResponse.ok) throw new Error(responseMessage(historyBody, 'Could not restore the saved conversation.'));
      const history = historyBody as MessageListResponse;
      if (!Array.isArray(history.messages)) throw new Error('The API returned invalid conversation history.');
      setMessages((history.messages as MessageResponse[])
        .filter((message) => (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
        .map((message) => ({ id: message.id, role: message.role as 'user' | 'assistant', content: message.content, status: message.status })));
      setConnected(true);
      setError(inferenceError);
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
    if (!connected || !content || busy || !model || !conversationId) return;
    setError('');
    setDraft('');
    setBusy(true);
    const selectedConversation = conversationId;
    try {
      const response = await fetch(`${API_BASE}/api/v1/chat/conversations/${selectedConversation}/turns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, content }),
        cache: 'no-store',
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(body, 'The local model request failed.'));
      const result = body as TurnResponse & { userMessage?: unknown };
      const user = result.userMessage as MessageResponse | undefined;
      const assistant = result.assistantMessage as MessageResponse | undefined;
      if (!user || !assistant || typeof assistant.content !== 'string') throw new Error('The API returned an invalid saved turn.');
      setMessages([...messages,
        { id: user.id, role: 'user', content: user.content, status: user.status },
        { id: assistant.id, role: 'assistant', content: assistant.content, status: assistant.status },
      ]);
      setConversations((current) => {
        const selected = current.find((item) => item.id === selectedConversation);
        if (!selected) return current;
        const title = selected.title === 'New conversation'
          ? content.replace(/\s+/g, ' ').trim().slice(0, 72)
          : selected.title;
        return [{ ...selected, title }, ...current.filter((item) => item.id !== selectedConversation)];
      });
      setLastBudget(result.budget);
    } catch (cause) {
      setDraft('');
      const historyResponse = await fetch(`${API_BASE}/api/v1/chat/conversations/${selectedConversation}/messages`, { cache: 'no-store' }).catch(() => null);
      if (historyResponse?.ok) {
        const history = await historyResponse.json().catch(() => ({})) as MessageListResponse;
        if (Array.isArray(history.messages)) setMessages((history.messages as MessageResponse[])
          .filter((message) => (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
          .map((message) => ({ id: message.id, role: message.role as 'user' | 'assistant', content: message.content, status: message.status })));
      }
      setError(cause instanceof Error ? cause.message : 'The local model request failed.');
    } finally {
      setBusy(false);
    }
  }

  async function startNewConversation() {
    setError('');
    setBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/v1/chat/conversations`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
      });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(body, 'Could not start a new conversation.'));
      const conversation = body as Conversation;
      setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
      setConversationId(conversation.id);
      setMessages([]);
      setLastBudget(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start a new conversation.');
    } finally {
      setBusy(false);
    }
  }

  async function openConversation(id: string) {
    setConversationId(id);
    setLoadingMessages(true);
    setError('');
    try {
      const response = await fetch(`${API_BASE}/api/v1/chat/conversations/${id}/messages`, { cache: 'no-store' });
      const body: unknown = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(responseMessage(body, 'Could not load conversation history.'));
      const result = body as MessageListResponse;
      if (!Array.isArray(result.messages)) throw new Error('The API returned invalid conversation history.');
      setMessages((result.messages as MessageResponse[])
        .filter((message) => (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string')
        .map((message) => ({ id: message.id, role: message.role as 'user' | 'assistant', content: message.content, status: message.status })));
      setLastBudget(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load conversation history.');
    } finally {
      setLoadingMessages(false);
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
          <span className={`hidden items-center gap-2 sm:flex ${connected && models.length > 0 ? 'text-emerald-200' : 'text-[var(--muted)]'}`}><i className={`size-2 rounded-full ${connected && models.length > 0 ? 'bg-emerald-300' : 'bg-zinc-500'}`} />{connected ? models.length > 0 ? 'Ready' : 'History available' : connecting ? 'Connecting' : 'Unavailable'}</span>
          <a className="text-[var(--muted)] hover:text-[var(--foreground)]" href="/services">Services</a>
          <a className="text-[var(--muted)] hover:text-[var(--foreground)]" href="/system">System</a>
          {((!connected && !connecting) || (connected && models.length === 0)) && <button className="text-[var(--muted)] hover:text-[var(--foreground)]" onClick={() => void connect()}>Retry</button>}
        </nav>
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        {!connected ? (
          <div className="my-auto py-12">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200/80">Private · local inference</p>
            <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">A conversation with your local model.</h1>
            <div className="mt-9 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 md:p-6">
              <p className="text-sm font-medium">{connecting ? 'Connecting to local chat services…' : 'Local chat unavailable'}</p>
              <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Chat requires the local inference server and PostgreSQL conversation store. Requests are accepted only from the configured local web origin.</p>
              {error && <p role="alert" className="mt-4 text-sm text-amber-200">{error}</p>}
              {!connecting && <button className="mt-4 rounded-xl bg-emerald-200 px-5 py-3 font-semibold text-[#102017]" onClick={() => void connect()}>Retry connection</button>}
            </div>
              <p className="mt-5 text-xs leading-5 text-[var(--muted)]">Project context is not attached yet. Saved chat history is kept separately from Hermes notes.</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] py-4">
              <label className="flex items-center gap-3 text-sm text-[var(--muted)]">Chat
                <select value={conversationId} onChange={(event) => void openConversation(event.target.value)} disabled={busy || loadingMessages} className="max-w-64 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)]">
                  {conversations.map((conversation) => <option key={conversation.id} value={conversation.id}>{conversation.title}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-3 text-sm text-[var(--muted)]">Model
                <select value={model} onChange={(event) => setModel(event.target.value)} disabled={busy} className="max-w-64 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[var(--foreground)]">
                  {models.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <button onClick={() => void startNewConversation()} disabled={busy || loadingMessages} className="text-sm text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40">New chat</button>
            </div>
            <div className="flex-1 py-6" aria-live="polite">
              {models.length === 0 && <p role="alert" className="rounded-xl border border-amber-200/20 bg-amber-100/5 p-4 text-sm text-amber-100">The configured inference provider returned no available models.</p>}
              {loadingMessages && <p className="text-sm text-[var(--muted)]" role="status">Loading saved conversation…</p>}
              {messages.length === 0 && !busy ? (
                <div className="grid min-h-[45vh] place-items-center text-center">
                  <div><p className="text-2xl font-medium">What would you like to work through?</p><p className="mt-3 text-sm text-[var(--muted)]">Messages are saved in local PostgreSQL and retained until the database is reset.</p></div>
                </div>
              ) : <div className="space-y-8">{messages.map((message) => <article key={message.id} className={message.role === 'user' ? 'flex justify-end' : 'border-b border-[var(--border)]/70 pb-8'}><div className={message.role === 'user' ? 'max-w-[88%] rounded-2xl bg-[#f7f7f7] px-5 py-3 leading-7' : 'max-w-full'}><p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--muted)]">{message.role === 'user' ? 'You' : 'Assistant'}{message.status === 'failed' ? ' · failed' : ''}</p>{message.role === 'assistant' && message.content ? <AssistantMarkdown content={message.content} /> : message.content || (message.status === 'failed' ? 'Generation failed. Your prompt is saved; send a new message to continue.' : '')}</div></article>)}{busy && <p className="text-sm text-[var(--muted)]" role="status">Waiting for local inference…</p>}</div>}
              <div ref={endRef} />
            </div>
            <form onSubmit={(event) => void send(event)} className="mb-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 focus-within:border-emerald-200/40">
              <textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} placeholder="Message the local model…" disabled={busy} className="block w-full resize-y bg-transparent px-2 py-2 leading-6 outline-none placeholder:text-[var(--muted)]" />
              <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
                <span className="text-xs text-[var(--muted)]">Enter to send · Shift+Enter for a new line</span>
                <button disabled={busy || loadingMessages || !conversationId || !draft.trim()} className="rounded-lg bg-emerald-200 px-4 py-2 text-sm font-semibold text-[#102017] disabled:opacity-40">{busy ? 'Generating…' : 'Send'}</button>
              </div>
            </form>
            {error && <p role="alert" className="mb-3 text-sm text-amber-200">{error}</p>}
            {lastBudget && typeof lastBudget.promptTokenEstimate === 'number' && typeof lastBudget.contextWindowTokens === 'number' && <p className="mb-3 text-center text-xs text-[var(--muted)]">Prompt size estimate: {lastBudget.promptTokenEstimate.toLocaleString()} / {lastBudget.contextWindowTokens.toLocaleString()} · UTF-8 byte estimate, not provider-reported token usage</p>}
            <p className="mb-5 text-center text-xs text-[var(--muted)]">No project context is attached. Chat history is saved in PostgreSQL until database reset; Hermes memory is separate.</p>
          </>
        )}
      </section>
      <footer className="border-t border-[var(--border)] py-4 text-center text-xs text-[var(--muted)]">Local development · history retained in PostgreSQL until reset · no per-chat deletion yet · Hermes memory separate</footer>
    </main>
  );
}
