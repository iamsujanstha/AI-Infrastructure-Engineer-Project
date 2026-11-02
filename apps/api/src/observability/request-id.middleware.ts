import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function requestIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  const suppliedId = request.header('x-request-id');
  const requestId = suppliedId && SAFE_REQUEST_ID.test(suppliedId) ? suppliedId : randomUUID();
  request.id = requestId;
  response.setHeader('x-request-id', requestId);
  next();
}
