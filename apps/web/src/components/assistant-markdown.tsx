'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

const components: Components = {
  h1: ({ children }) => <h1 className="mb-4 mt-8 text-2xl font-semibold tracking-tight first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-3 mt-7 text-xl font-semibold tracking-tight">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-2 mt-6 text-lg font-semibold">{children}</h3>,
  p: ({ children }) => <p className="my-4 leading-7 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-4 list-disc space-y-2 pl-6 marker:text-emerald-300">{children}</ul>,
  ol: ({ children }) => <ol className="my-4 list-decimal space-y-2 pl-6 marker:font-medium marker:text-emerald-300">{children}</ol>,
  li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-[var(--foreground)]">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="my-5 border-l-2 border-emerald-300/60 pl-4 text-[var(--muted)]">{children}</blockquote>,
  a: ({ href, children }) => <a className="text-emerald-200 underline decoration-emerald-200/40 underline-offset-4 hover:decoration-emerald-200" href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  hr: () => <hr className="my-7 border-[var(--border)]" />,
  table: ({ children }) => <div className="my-5 overflow-x-auto rounded-xl border border-[var(--border)]"><table className="w-full border-collapse text-left text-sm">{children}</table></div>,
  th: ({ children }) => <th className="border-b border-[var(--border)] bg-white/[0.04] px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-[var(--border)] px-3 py-2 align-top">{children}</td>,
  pre: ({ children }) => <div className="my-5 overflow-hidden rounded-xl border border-white/10 bg-[#0d1117]"><pre className="overflow-x-auto p-4 text-[13px] leading-6">{children}</pre></div>,
  code: ({ className, children }) => <code className={className ? `${className} font-mono` : 'rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[0.9em] text-emerald-100'}>{children}</code>,
};

export function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="markdown-content min-w-0 break-words text-[15px] leading-7">
      <ReactMarkdown components={components} remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} skipHtml>
        {content}
      </ReactMarkdown>
    </div>
  );
}
