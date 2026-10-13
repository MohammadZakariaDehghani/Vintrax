import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { tap } from 'rxjs/operators';
import type { Observable } from 'rxjs';
import { AUDIT_KEY } from '../decorators';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../auth/auth-user';

interface AuditMetadata {
  action: string;
  entityType: string;
}

/**
 * Writes an audit entry for routes annotated with `@Audit(...)`.
 *
 * Only successful calls are recorded: a rejected attempt is a security signal
 * belonging in the application log, not a record that something happened. The
 * write is fire-and-forget so audit persistence never fails a user's request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<AuditMetadata>(AUDIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!metadata) return next.handle();

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser; requestId?: string }>();

    return next.handle().pipe(
      tap((result) => {
        // Prefer an id from the response body, so create actions record the id
        // they produced rather than nothing.
        const responseId =
          result && typeof result === 'object' && 'id' in result
            ? String((result as { id: unknown }).id)
            : undefined;

        void this.audit.record({
          actorId: request.user?.id ?? null,
          actorEmail: request.user?.email ?? null,
          action: metadata.action,
          entityType: metadata.entityType,
          entityId: responseId ?? (request.params as Record<string, string>)['id'] ?? null,
          ipAddress: this.clientIp(request),
          userAgent: request.headers['user-agent'] ?? null,
          metadata: {
            method: request.method,
            path: request.originalUrl,
            requestId: request.requestId ?? null,
          },
        });
      }),
    );
  }

  /** The address as Express resolves it under `trust proxy` (see ClientIp). */
  private clientIp(request: Request): string | null {
    return request.ip ?? null;
  }
}
