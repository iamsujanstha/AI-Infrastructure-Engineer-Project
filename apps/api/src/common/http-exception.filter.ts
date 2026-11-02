import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Logger as PinoLogger } from 'pino';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const expectedHttpException = exception instanceof HttpException && status !== HttpStatus.INTERNAL_SERVER_ERROR;
    const responsePayload = exception instanceof HttpException ? exception.getResponse() : undefined;
    const details = responsePayload && typeof responsePayload === 'object'
      ? responsePayload as Record<string, unknown>
      : undefined;
    const safePayload: Record<string, unknown> = { statusCode: status, requestId: request.id };
    if (expectedHttpException) {
      if (typeof details?.status === 'string') safePayload.status = details.status;
      if (typeof details?.dependency === 'string') safePayload.dependency = details.dependency;
      const message = typeof responsePayload === 'string'
        ? responsePayload
        : details?.message;
      if (typeof message === 'string' || Array.isArray(message)) safePayload.message = message;
    } else {
      safePayload.message = 'Internal server error';
    }

    if (!expectedHttpException) {
      this.logger.error({
        requestId: request.id,
        method: request.method,
        path: request.path,
        errorName: exception instanceof Error ? exception.name : 'UnknownError',
      }, 'Unhandled request error');
    }

    response.status(status).json(safePayload);
  }
}
