// ---------------------------------------------------------------------------
// Generic Zod validation middleware. Wraps any schema — including the
// payload schemas already defined in @mafia/shared for the socket layer,
// so the HTTP and realtime surfaces validate with the exact same rules —
// and rejects a bad request with a typed AppError('VALIDATION_ERROR')
// carrying the Zod field errors, instead of every route hand-rolling this.
// ---------------------------------------------------------------------------

import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../errors';

type RequestPart = 'body' | 'params' | 'query';
type MutableRequest = Record<RequestPart, unknown>;

/**
 * Validates `req[part]` against `schema`. On success, replaces `req[part]`
 * with the parsed (and possibly coerced/defaulted) value, so downstream
 * handlers can trust its shape is exactly what the schema describes rather
 * than the raw, unparsed input.
 */
export function validate<Schema extends ZodTypeAny>(schema: Schema, part: RequestPart = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      next(
        new AppError('VALIDATION_ERROR', 'Request validation failed.', {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        }),
      );
      return;
    }
    (req as unknown as MutableRequest)[part] = result.data;
    next();
  };
}
