import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodTypeAny, z } from 'zod';

/**
 * Validates a request body or query against a schema from `@vintrax/shared`, so the
 * API and the web app enforce exactly the same rules.
 *
 * Failures become a 400 whose `details` map field paths to messages, which the
 * web app renders inline next to the offending input.
 */
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;

    const details: Record<string, string[]> = {};
    for (const issue of result.error.issues) {
      // Zod reports whole-object refinements with an empty path.
      const key = issue.path.length ? issue.path.join('.') : '_';
      (details[key] ??= []).push(issue.message);
    }

    throw new BadRequestException({
      message: 'Validation failed',
      details,
    });
  }
}

/** Convenience factory so controllers read `@Body(zodBody(schema))`. */
export const zodBody = <T extends ZodTypeAny>(schema: T) => new ZodValidationPipe(schema);
export const zodQuery = <T extends ZodTypeAny>(schema: T) => new ZodValidationPipe(schema);
