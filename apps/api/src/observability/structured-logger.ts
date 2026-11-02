import type { LoggerService } from '@nestjs/common';
import type { Logger as PinoLogger } from 'pino';

function messageText(message: unknown): string {
  if (typeof message === 'string') return message;
  if (message instanceof Error) return message.message;
  try {
    return JSON.stringify(message) ?? String(message);
  } catch {
    return '[unserializable log message]';
  }
}

export class StructuredLogger implements LoggerService {
  constructor(private readonly logger: PinoLogger) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info({ context: optionalParams[0] }, messageText(message));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error({ context: optionalParams[0] }, messageText(message));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn({ context: optionalParams[0] }, messageText(message));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug({ context: optionalParams[0] }, messageText(message));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace({ context: optionalParams[0] }, messageText(message));
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.fatal({ context: optionalParams[0] }, messageText(message));
  }
}
