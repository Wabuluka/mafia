// ---------------------------------------------------------------------------
// AppError — the one error type route handlers should throw (or pass to
// `next()`) for any expected, "the client did something that maps to an
// HTTP status" failure. The centralized error handler (errorHandler.ts)
// knows how to turn this into the consistent response shape; anything else
// thrown is treated as an unexpected 500 and never leaks its message/stack
// in production.
// ---------------------------------------------------------------------------

export type AppErrorCode =
  | 'VALIDATION_ERROR'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_IN_PROGRESS'
  | 'GAME_NOT_FOUND'
  | 'GAME_NOT_FINISHED'
  | 'UNAUTHENTICATED'
  | 'RATE_LIMITED'
  | 'ROOM_CODE_EXHAUSTED'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  VALIDATION_ERROR: 400,
  ROOM_NOT_FOUND: 404,
  ROOM_FULL: 409,
  GAME_IN_PROGRESS: 409,
  GAME_NOT_FOUND: 404,
  GAME_NOT_FINISHED: 409,
  UNAUTHENTICATED: 401,
  RATE_LIMITED: 429,
  ROOM_CODE_EXHAUSTED: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** Extra machine-readable detail safe to send to the client (e.g. Zod
   * field errors). Never put anything sensitive here. */
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}
