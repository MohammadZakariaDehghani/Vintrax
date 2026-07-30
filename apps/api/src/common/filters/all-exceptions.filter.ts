import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiErrorBody } from '@atlas/shared';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';

/**
 * Normalises every failure into the `ApiErrorBody` contract so the web app has a
 * single error shape to handle. Unexpected errors are logged in full but reported
 * to the client generically — internal messages never reach the browser.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { status, error, message, details } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiErrorBody = {
      statusCode: status,
      error,
      message,
      ...(details ? { details } : {}),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(body);
  }

  private describe(exception: unknown): {
    status: number;
    error: string;
    message: string;
    details?: Record<string, string[]>;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'string') {
        return { status, error: exception.name, message: payload };
      }

      const record = payload as Record<string, unknown>;
      const rawMessage = record['message'];
      return {
        status,
        error: typeof record['error'] === 'string' ? record['error'] : exception.name,
        message: Array.isArray(rawMessage)
          ? rawMessage.join(', ')
          : typeof rawMessage === 'string'
            ? rawMessage
            : exception.message,
        details: this.asDetails(record['details']),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.describePrisma(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
    };
  }

  private describePrisma(exception: Prisma.PrismaClientKnownRequestError): {
    status: number;
    error: string;
    message: string;
  } {
    switch (exception.code) {
      // Unique constraint violation.
      case 'P2002': {
        const target = exception.meta?.['target'];
        const field = Array.isArray(target) ? target.join(', ') : String(target ?? 'field');
        return {
          status: HttpStatus.CONFLICT,
          error: 'Conflict',
          message: `A record with this ${field} already exists`,
        };
      }
      // Foreign key constraint failed.
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          error: 'BadRequest',
          message: 'Referenced record does not exist',
        };
      // Record required by the operation was not found.
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          error: 'NotFound',
          message: 'Record not found',
        };
      default:
        this.logger.error(`Unhandled Prisma error ${exception.code}`, exception.stack);
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          error: 'InternalServerError',
          message: 'An unexpected database error occurred',
        };
    }
  }

  private asDetails(value: unknown): Record<string, string[]> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) && entry[1].every((item) => typeof item === 'string'),
    );
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
}
