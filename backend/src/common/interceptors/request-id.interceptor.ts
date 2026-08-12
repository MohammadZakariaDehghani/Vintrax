import { randomUUID } from 'node:crypto';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';

/**
 * Assigns every request a correlation id and echoes it back as `X-Request-Id`.
 *
 * The id appears in error responses and in the audit trail, so a user reporting
 * "I got an error" can be traced to exact log lines. An inbound `X-Request-Id`
 * is honoured, which lets a reverse proxy or upstream service own the trace.
 */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & { requestId?: string }>();
    const response = http.getResponse<Response>();

    const inbound = request.headers['x-request-id'];
    const requestId = typeof inbound === 'string' && inbound.length > 0 ? inbound : randomUUID();

    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    return next.handle();
  }
}
