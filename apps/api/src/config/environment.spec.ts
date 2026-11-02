import { describe, expect, it } from 'vitest';
import { parseEnvironment } from './environment';

describe('parseEnvironment', () => {
  it('provides host-local development defaults and normalizes allowed origins', () => {
    const environment = parseEnvironment({ CORS_ORIGINS: 'http://localhost:3000, https://dev.example.test' });

    expect(environment.API_PORT).toBe(4000);
    expect(environment.API_HOST).toBe('127.0.0.1');
    expect(environment.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://dev.example.test']);
    expect(environment.PG_POOL_MAX).toBe(10);
  });

  it('rejects unsafe development credentials in production', () => {
    expect(() => parseEnvironment({ NODE_ENV: 'production' })).toThrow(/development credentials/);
  });

  it('rejects a URL path in a CORS origin', () => {
    expect(() => parseEnvironment({ CORS_ORIGINS: 'http://localhost:3000/app' })).toThrow(/invalid origin/);
  });

  it('rejects non-PostgreSQL connection URLs', () => {
    expect(() => parseEnvironment({ DATABASE_URL: 'https://db.example.test' })).toThrow(/must use postgres/);
  });

  it('rejects localhost browser origins in production', () => {
    expect(() => parseEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://platform:secret@db.example.test:5432/platform',
      REDIS_URL: 'rediss://:secret@redis.example.test:6379',
      CORS_ORIGINS: 'http://localhost:3000',
    })).toThrow(/localhost origins/);
  });

  it('rejects IPv6 loopback browser origins in production', () => {
    expect(() => parseEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://platform:secret@db.example.test:5432/platform',
      REDIS_URL: 'rediss://:secret@redis.example.test:6379',
      CORS_ORIGINS: 'http://[::1]:3000',
    })).toThrow(/localhost origins/);
  });
});
