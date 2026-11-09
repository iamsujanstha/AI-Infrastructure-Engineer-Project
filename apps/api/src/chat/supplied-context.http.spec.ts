import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Module, VersioningType, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import { LocalChatOriginGuard } from '../auth/local-chat-origin.guard';
import { LegacyLocalChatGuard } from '../auth/legacy-local-chat.guard';
import { INFERENCE_PROVIDER, InferenceUnavailableError } from '../inference/inference-provider';
import { ChatService } from './chat.service';
import { SuppliedContextController } from './supplied-context.controller';
import { SuppliedContextService } from './supplied-context.service';

const complete = vi.fn();
const values: Record<string, unknown> = {
  NODE_ENV: 'test', API_HOST: '127.0.0.1', API_PORT: 4000, LOCAL_CHAT_CONTAINER_MODE: false,
  LEGACY_LOCAL_CHAT_ENABLED:true,
  CORS_ORIGINS: ['http://127.0.0.1:3000'], MLX_CONTEXT_WINDOW_TOKENS: 8192, MLX_MAX_OUTPUT_TOKENS: 100,
};

@Module({
  controllers: [SuppliedContextController],
  providers: [
    ChatService, SuppliedContextService, LocalChatOriginGuard,LegacyLocalChatGuard,
    { provide: INFERENCE_PROVIDER, useValue: { listModels: async () => ['model-a'], complete } },
    { provide: ConfigService, useValue: { get: (key: string) => values[key] } },
  ],
})
class IsolatedContextApp {}

describe('supplied-context HTTP boundary (real Nest, fake inference, no database)', () => {
  let app: INestApplication;
  let url: string;
  beforeAll(async () => {
    app = await NestFactory.create(IsolatedContextApp, { logger: false, bodyParser: false });
    app.use(json({ limit: '64kb' }));
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.listen(0, '127.0.0.1');
    url = `${await app.getUrl()}/api/v1/chat/context-answers`;
  });
  afterAll(async () => { await app?.close(); });
  beforeEach(() => {
    complete.mockReset().mockResolvedValue('{"sourceIds":["S1"]}');
    values.NODE_ENV = 'test';
  });

  async function post(origin: string | null = 'http://127.0.0.1:3000', changes: Record<string, unknown> = {}): Promise<Response> {
    return fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify({ model: 'model-a', question: 'How much leave?', context: 'Employees get 12 days.', ...changes }),
    });
  }

  it('serves exact extracts through the real route and disables response caching', async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ status: 'evidence_selected', sources: [{ text: 'Employees get 12 days.' }] });
  });

  it('publishes the actual endpoint and explicit response schema in OpenAPI', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Test').setVersion('1').build());
    expect(document.paths['/api/v1/chat/context-answers']?.post).toBeDefined();
    expect(document.components?.schemas?.SuppliedContextResponse).toBeDefined();
  });

  it.each([null, 'https://untrusted.example'])('denies missing or unconfigured origins before inference: %s', async (origin) => {
    expect((await post(origin)).status).toBe(403);
    expect(complete).not.toHaveBeenCalled();
  });

  it('denies production before inference', async () => {
    values.NODE_ENV = 'production';
    expect((await post()).status).toBe(403);
    expect(complete).not.toHaveBeenCalled();
  });
  it('denies the legacy workspace when its explicit local-only flag is off',async()=>{
    values.LEGACY_LOCAL_CHAT_ENABLED=false;
    try{expect((await post()).status).toBe(403);expect(complete).not.toHaveBeenCalled();}
    finally{values.LEGACY_LOCAL_CHAT_ENABLED=true;}
  });

  it('rejects raw model prose rather than returning it as an answer', async () => {
    complete.mockResolvedValue('Outside knowledge: unlimited leave.');
    const response = await post();
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain('unlimited leave');
  });

  it('propagates provider outage and recovers without saved state', async () => {
    complete.mockRejectedValueOnce(new InferenceUnavailableError());
    expect((await post()).status).toBe(503);
    expect((await post()).status).toBe(200);
  });

  it('rejects oversized bodies before inference', async () => {
    expect((await post(undefined, { context: 'x'.repeat(70000) })).status).toBe(413);
    expect(complete).not.toHaveBeenCalled();
  });
});
