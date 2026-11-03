import { describe, expect, it, vi } from 'vitest';
import { ChatService } from './chat.service';
import type { InferenceProvider } from '../inference/inference-provider';
import { InferenceUnavailableError } from '../inference/inference-provider';
import type { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';

function createService(provider: InferenceProvider): ChatService {
  const values = {
    MLX_DEFAULT_MODEL: 'model-a', MLX_MAX_OUTPUT_TOKENS: 100, MLX_CONTEXT_WINDOW_TOKENS: 8192,
  };
  const config = { get: (key: keyof typeof values) => values[key] } as unknown as ConfigService<AppEnvironment, true>;
  return new ChatService(provider, config);
}

describe('ChatService', () => {
  it('lists models reported by the provider and uses configured default only when present', async () => {
    const provider: InferenceProvider = { listModels: vi.fn().mockResolvedValue(['model-a', 'model-b']), complete: vi.fn() };
    await expect(createService(provider).listModels()).resolves.toEqual({ models: ['model-a', 'model-b'], defaultModel: 'model-a' });
  });

  it('passes the selected real model, local clock context, and bounded history through the provider port', async () => {
    const provider: InferenceProvider = { listModels: vi.fn().mockResolvedValue(['model-a']), complete: vi.fn().mockResolvedValue('hello') };
    const result = await createService(provider).complete({ model: 'model-a', messages: [{ role: 'user', content: 'hi' }] }, 'request-1');
    expect(result.content).toBe('hello');
    expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
      model: 'model-a', requestId: 'request-1', maxOutputTokens: 100,
      messages: expect.arrayContaining([expect.objectContaining({ role: 'system', content: expect.stringContaining('current local date and time') })]),
    }));
    expect(result.budget.estimator).toBe('utf8_bytes_plus_256_template_reserve');
  });

  it('rejects malformed turn order and models not returned by the provider', async () => {
    const provider: InferenceProvider = { listModels: vi.fn().mockResolvedValue(['model-a']), complete: vi.fn() };
    const service = createService(provider);
    await expect(service.complete({ model: 'model-a', messages: [{ role: 'assistant', content: 'no' }] }, 'r'))
      .rejects.toMatchObject({ status: 400 });
    await expect(service.complete({ model: 'other', messages: [{ role: 'user', content: 'hi' }] }, 'r'))
      .rejects.toMatchObject({ status: 400 });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('rejects over-budget history before calling inference', async () => {
    const provider: InferenceProvider = { listModels: vi.fn().mockResolvedValue(['model-a']), complete: vi.fn() };
    const service = createService(provider);
    await expect(service.complete({ model: 'model-a', messages: [{ role: 'user', content: 'x'.repeat(9000) }] }, 'r'))
      .rejects.toMatchObject({ status: 400 });
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('maps provider unavailability to a safe service-unavailable response', async () => {
    const provider: InferenceProvider = { listModels: vi.fn().mockRejectedValue(new InferenceUnavailableError()), complete: vi.fn() };
    await expect(createService(provider).listModels()).rejects.toMatchObject({ status: 503 });
  });
});
