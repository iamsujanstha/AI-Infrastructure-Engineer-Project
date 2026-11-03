import { ForbiddenException, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIP } from 'node:net';
import type { Request } from 'express';
import type { AppEnvironment } from '../config/environment';

function isLoopbackHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '');
  return normalized === 'localhost'
    || (isIP(normalized) === 4 && normalized.startsWith('127.'))
    || (isIP(normalized) === 6 && normalized === '::1');
}

@Injectable()
export class LocalChatOriginGuard implements CanActivate {
  constructor(@Inject(ConfigService) private readonly config: ConfigService<AppEnvironment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const environment = this.config.get('NODE_ENV', { infer: true });
    const apiHost = this.config.get('API_HOST', { infer: true });
    const origin = request.header('origin');
    const allowedOrigins = this.config.get('CORS_ORIGINS', { infer: true });

    // This deliberately permits only the local single-user prototype; it is not user authentication.
    if (environment === 'production' || !isLoopbackHost(apiHost)
        || typeof origin !== 'string' || !allowedOrigins.includes(origin)) {
      throw new ForbiddenException('Chat is available only from the configured local web origin.');
    }
    return true;
  }
}
