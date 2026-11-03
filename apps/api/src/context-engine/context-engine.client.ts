import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { AppEnvironment } from '../config/environment';

const TRACEPARENT_PATTERN = /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[0-9a-f]$/i;

export class ContextEngineRequestError extends Error {
  constructor(readonly timedOut: boolean, options?: ErrorOptions) {
    super(timedOut ? 'Context engine request timed out' : 'Context engine unavailable', options);
    this.name = 'ContextEngineRequestError';
  }
}

@Injectable()
export class ContextEngineClient {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>) {}

  async checkHealth(request: Request): Promise<void> {
    const baseUrl = this.config.get('CONTEXT_ENGINE_URL', { infer: true }).replace(/\/$/, '');
    const timeoutMs = this.config.get('CONTEXT_ENGINE_TIMEOUT_MS', { infer: true });
    const headers = new Headers({
      authorization: `Bearer ${this.config.get('CONTEXT_ENGINE_TOKEN', { infer: true })}`,
      'x-request-id': String(request.id),
    });
    const traceparent = request.header('traceparent');
    if (traceparent && TRACEPARENT_PATTERN.test(traceparent)) headers.set('traceparent', traceparent);

    try {
      const result = await fetch(`${baseUrl}/internal/health`, {
        method: 'GET', headers, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store',
      });
      if (!result.ok) throw new ContextEngineRequestError(false);
      const payload: unknown = await result.json();
      if (typeof payload !== 'object' || payload === null || !('status' in payload) || payload.status !== 'ok') {
        throw new ContextEngineRequestError(false);
      }
    } catch (error) {
      if (error instanceof ContextEngineRequestError) throw error;
      throw new ContextEngineRequestError(error instanceof DOMException && error.name === 'TimeoutError', { cause: error });
    }
  }
}
