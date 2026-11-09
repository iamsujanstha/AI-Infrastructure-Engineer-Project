import type { QueryConfig } from 'pg';

// pg supports a per-query client read timeout; its published QueryConfig type omits that field.
export function deadlineQuery(text: string, values?: readonly unknown[], timeoutMs?: number): QueryConfig<unknown[]> & { query_timeout?: number } {
  return { text, values: values ? [...values] : undefined, query_timeout: timeoutMs };
}
