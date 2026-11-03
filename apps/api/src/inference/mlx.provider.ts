import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import type { InferenceCompletionInput, InferenceMessage, InferenceProvider } from './inference-provider';
import { InferenceResponseError, InferenceTimeoutError, InferenceUnavailableError } from './inference-provider';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new InferenceResponseError();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new InferenceResponseError();
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new InferenceResponseError();
  }
}

@Injectable()
export class MlxProvider implements InferenceProvider {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>) {}

  async listModels(): Promise<readonly string[]> {
    const payload = await this.request('/v1/models');
    if (!isRecord(payload) || !Array.isArray(payload.data)) throw new InferenceResponseError();
    const models = payload.data.flatMap((item: unknown) => {
      if (!isRecord(item) || typeof item.id !== 'string' || item.id.length < 1 || item.id.length > 250) return [];
      return [item.id];
    });
    return [...new Set(models)].sort();
  }

  async complete(input: InferenceCompletionInput): Promise<string> {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages satisfies readonly InferenceMessage[],
      max_tokens: input.maxOutputTokens,
      stream: false,
    };
    // Qwen3 defaults to spending the output budget on hidden reasoning before its user-facing answer.
    if (/qwen3/i.test(input.model) && !this.config.get('MLX_QWEN3_ENABLE_THINKING', { infer: true })) {
      body.chat_template_kwargs = { enable_thinking: false };
    }
    const payload = await this.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': input.requestId },
      body: JSON.stringify(body),
    });
    if (!isRecord(payload) || !Array.isArray(payload.choices)) throw new InferenceResponseError();
    const choice = payload.choices[0];
    if (!isRecord(choice) || !isRecord(choice.message) || typeof choice.message.content !== 'string'
        || choice.message.content.trim().length === 0) {
      throw new InferenceResponseError();
    }
    return choice.message.content;
  }

  private async request(path: string, init?: RequestInit): Promise<unknown> {
    const baseUrl = this.config.get('MLX_BASE_URL', { infer: true }).replace(/\/$/, '');
    const timeoutMs = this.config.get('MLX_TIMEOUT_MS', { infer: true });
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        cache: 'no-store',
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new InferenceTimeoutError({ cause: error });
      }
      throw new InferenceUnavailableError({ cause: error });
    }
    if (!response.ok) throw new InferenceUnavailableError();
    return readJson(response);
  }
}
