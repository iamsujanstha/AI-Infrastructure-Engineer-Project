'use client';

import { useState } from 'react';
import { LocalChat } from './local-chat';
import { SuppliedContextChat } from './supplied-context-chat';

export function LocalWorkspace() {
  const [mode, setMode] = useState<'reference' | 'general'>('reference');
  return <>
    <nav aria-label="Assistant mode" className="flex flex-wrap justify-center gap-3 border-b border-[var(--border)] px-5 py-3 text-sm">
      <button aria-pressed={mode === 'reference'} onClick={() => setMode('reference')} className={mode === 'reference' ? 'rounded-lg bg-emerald-200 px-4 py-2 font-medium text-[#102017]' : 'px-4 py-2 text-[var(--muted)]'}>My reference only</button>
      <button aria-pressed={mode === 'general'} onClick={() => setMode('general')} className={mode === 'general' ? 'rounded-lg bg-emerald-200 px-4 py-2 font-medium text-[#102017]' : 'px-4 py-2 text-[var(--muted)]'}>General chat · uses model knowledge</button>
      <a href="/cms" className="px-4 py-2 text-emerald-200">People CMS · sign in</a>
    </nav>
    {mode === 'reference' ? <SuppliedContextChat /> : <LocalChat />}
  </>;
}
