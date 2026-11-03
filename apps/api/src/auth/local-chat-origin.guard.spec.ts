import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment';
import { LocalChatOriginGuard } from './local-chat-origin.guard';

function createGuard(overrides: Partial<AppEnvironment> = {}) {
  const values = {
    NODE_ENV: 'development', API_HOST: '127.0.0.1', CORS_ORIGINS: ['http://127.0.0.1:3000'], ...overrides,
  };
  const config = { get: (key: keyof typeof values) => values[key] } as unknown as ConfigService<AppEnvironment, true>;
  return new LocalChatOriginGuard(config);
}

function context(origin: string | undefined) {
  return { switchToHttp: () => ({ getRequest: () => ({ header: () => origin }) }) } as never;
}

describe('LocalChatOriginGuard', () => {
  it('accepts a configured browser origin when the API binds to loopback in development', () => {
    expect(createGuard().canActivate(context('http://127.0.0.1:3000'))).toBe(true);
  });

  it('rejects missing or unconfigured origins', () => {
    const guard = createGuard();
    for (const origin of [undefined, 'https://untrusted.example']) {
      expect(() => guard.canActivate(context(origin))).toThrow(ForbiddenException);
    }
  });

  it('rejects production and non-loopback API bindings', () => {
    expect(() => createGuard({ NODE_ENV: 'production' }).canActivate(context('http://127.0.0.1:3000')))
      .toThrow(ForbiddenException);
    expect(() => createGuard({ API_HOST: '0.0.0.0' }).canActivate(context('http://127.0.0.1:3000')))
      .toThrow(ForbiddenException);
  });
});
