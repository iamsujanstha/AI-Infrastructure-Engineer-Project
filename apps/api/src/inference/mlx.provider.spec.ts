import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import { MlxProvider } from './mlx.provider';

function createProvider(enableThinking = false): MlxProvider {
  const values = {
    MLX_BASE_URL: 'http://127.0.0.1:8080',
    MLX_TIMEOUT_MS: 10_000,
    MLX_QWEN3_ENABLE_THINKING: enableThinking,
  };
  return new MlxProvider({ get: (key: keyof typeof values) => values[key] } as unknown as ConfigService<AppEnvironment, true>);
}

function installFetchMock() {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const input = (model: string) => ({
  model,
  requestId: 'request-1',
  messages: [{ role: 'user' as const, content: 'say ok' }],
  maxOutputTokens: 32,
});

describe('MlxProvider chat-template settings', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('disables Qwen3 hidden thinking by default so generation budget goes to the answer', async () => {
    const fetchMock = installFetchMock();
    await expect(createProvider().complete(input('mlx-community/Qwen3-8B-4bit'))).resolves.toBe('ok');
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(requestBody.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it('allows thinking to be enabled explicitly for Qwen3', async () => {
    const fetchMock = installFetchMock();
    await createProvider(true).complete(input('mlx-community/Qwen3-8B-4bit'));
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(requestBody).not.toHaveProperty('chat_template_kwargs');
  });

  it('does not pass Qwen3-specific template settings to other model families', async () => {
    const fetchMock = installFetchMock();
    await createProvider().complete(input('mlx-community/Llama-3.2-3B-Instruct-4bit'));
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(requestBody).not.toHaveProperty('chat_template_kwargs');
  });
});
