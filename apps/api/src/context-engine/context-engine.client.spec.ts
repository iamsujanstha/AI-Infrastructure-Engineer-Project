import { describe, expect, it, vi, afterEach } from 'vitest';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { parseEnvironment } from '../config/environment';
import { ContextEngineClient } from './context-engine.client';

const request = { id: 'foundation-test', header: () => undefined } as unknown as Request;
afterEach(() => vi.unstubAllGlobals());
describe('ContextEngineClient boundary', () => {
  const client = new ContextEngineClient(new ConfigService(parseEnvironment({})));
  it('classifies service outage without leaking upstream details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('private endpoint detail')));
    await expect(client.checkHealth(request)).rejects.toMatchObject({ timedOut: false, message: 'Context engine unavailable' });
  });
  it('classifies deadlines', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('deadline', 'TimeoutError')));
    await expect(client.checkHealth(request)).rejects.toMatchObject({ timedOut: true });
  });
  it('rejects malformed successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    await expect(client.checkHealth(request)).rejects.toMatchObject({ timedOut: false });
  });
});

