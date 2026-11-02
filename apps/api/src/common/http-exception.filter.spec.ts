import { HttpException, type ArgumentsHost } from '@nestjs/common';
import type { Logger } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  it('preserves safe readiness classification for expected 503 responses', () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const request = { id: 'request-123', method: 'GET', path: '/health/inference' };
    const logger = { error: vi.fn() } as unknown as Logger;
    const host = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const filter = new HttpExceptionFilter(logger);

    filter.catch(new HttpException({ status: 'not_configured', dependency: 'inference' }, 503), host);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 503,
      requestId: 'request-123',
      status: 'not_configured',
      dependency: 'inference',
    });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('hides unexpected exception details from the caller', () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const request = { id: 'request-456', method: 'GET', path: '/api/v1/example' };
    const logger = { error: vi.fn() } as unknown as Logger;
    const host = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ArgumentsHost;
    const filter = new HttpExceptionFilter(logger);

    filter.catch(new Error('database password leaked'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      statusCode: 500,
      requestId: 'request-456',
      message: 'Internal server error',
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
