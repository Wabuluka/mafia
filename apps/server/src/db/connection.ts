// ---------------------------------------------------------------------------
// MongoDB connection lifecycle: pooling, connect-time retry with exponential
// backoff, and graceful shutdown. This is the ONLY module that constructs a
// MongoClient — everything else (repositories) calls `getDb()`.
//
// See the module-level comment in `index.ts` for the hot-path boundary this
// whole `db/` package exists behind.
// ---------------------------------------------------------------------------

import { MongoClient, MongoServerError, type Db } from 'mongodb';
import { env } from '../env';
import { logger } from '../logger';

const MAX_CONNECT_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

let client: MongoClient | undefined;
let db: Db | undefined;
let connecting: Promise<Db> | undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Auth/authorization failures are not transient — retrying them just delays
 * the inevitable and hides a misconfigured deployment behind a slow crash.
 * Everything else (network blips, primary election, DNS hiccup) is worth
 * retrying with backoff.
 */
function isFatalAuthError(err: unknown): boolean {
  if (err instanceof MongoServerError) {
    // 18 = AuthenticationFailed, 13 = Unauthorized
    return err.code === 18 || err.code === 13;
  }
  return false;
}

async function connectWithRetry(): Promise<Db> {
  const newClient = new MongoClient(env.MONGO_URI, {
    maxPoolSize: env.MONGO_MAX_POOL_SIZE,
    minPoolSize: env.MONGO_MIN_POOL_SIZE,
    connectTimeoutMS: env.MONGO_CONNECT_TIMEOUT_MS,
    serverSelectionTimeoutMS: env.MONGO_CONNECT_TIMEOUT_MS,
  });

  for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await newClient.connect();
      // Cheap round-trip that actually exercises auth, unlike connect()
      // alone which can succeed before credentials are checked server-side.
      await newClient.db().command({ ping: 1 });
      client = newClient;
      db = newClient.db();
      logger.info('connected to MongoDB', { attempt, maxAttempts: MAX_CONNECT_ATTEMPTS });
      return db;
    } catch (err) {
      if (isFatalAuthError(err)) {
        await newClient.close().catch(() => undefined);
        // Fail fast and loud: bad credentials should crash boot, not retry
        // silently into a confusing timeout five attempts later.
        logger.error('FATAL: MongoDB authentication/authorization failed. Check MONGO_URI credentials.');
        throw err;
      }

      if (attempt === MAX_CONNECT_ATTEMPTS) {
        await newClient.close().catch(() => undefined);
        logger.error('FATAL: could not connect to MongoDB', { attempts: MAX_CONNECT_ATTEMPTS });
        throw err;
      }

      const backoffMs = Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      const jitterMs = Math.floor(Math.random() * 250);
      logger.warn('MongoDB connection attempt failed, retrying', {
        attempt,
        maxAttempts: MAX_CONNECT_ATTEMPTS,
        retryInMs: backoffMs + jitterMs,
        error: err instanceof Error ? err.message : String(err),
      });
      await sleep(backoffMs + jitterMs);
    }
  }

  // Unreachable — the loop above always returns or throws — but keeps the
  // function's return type honest without a non-null assertion.
  throw new Error('[db] connection retry loop exited without resolving');
}

/**
 * Returns the singleton Db handle, connecting (with retry/backoff) on first
 * call. Safe to call concurrently — concurrent callers await the same
 * in-flight connection attempt rather than racing to open multiple clients.
 */
export async function getDb(): Promise<Db> {
  if (db) return db;
  connecting ??= connectWithRetry().finally(() => {
    connecting = undefined;
  });
  return connecting;
}

/** Closes the pooled connection. Call once, at process shutdown. */
export async function closeDb(): Promise<void> {
  if (!client) return;
  const closing = client;
  client = undefined;
  db = undefined;
  logger.info('closing MongoDB connection pool...');
  await closing.close();
  logger.info('MongoDB connection pool closed.');
}

let shutdownHooked = false;

/**
 * Registers a SIGTERM (and SIGINT, for local dev Ctrl+C) handler that closes
 * the pool before the process exits. Idempotent — safe to call more than
 * once (e.g. from tests) without stacking duplicate listeners.
 *
 * `beforeClose`, if given, runs first — e.g. the realtime layer passes a
 * hook that marks every active in-memory game ABANDONED (see
 * realtime/restart.ts's `abandonAllActiveGames`) so a clean shutdown never
 * leaves a misleadingly-IN_PROGRESS game document for the next boot's
 * crash-recovery pass to have to guess about. This module deliberately
 * takes that as a plain callback rather than importing from realtime/ —
 * db/ is a lower-level module and shouldn't depend upward on it.
 */
export function registerGracefulShutdown(beforeClose?: () => Promise<void>): void {
  if (shutdownHooked) return;
  shutdownHooked = true;

  const shutdown = (signal: string) => {
    logger.info('received shutdown signal, shutting down gracefully...', { signal });
    Promise.resolve(beforeClose?.())
      .catch((err) => {
        logger.error('error running pre-shutdown hook, continuing shutdown anyway', {
          error: err instanceof Error ? err.message : String(err),
        });
      })
      .then(() => closeDb())
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error('error during shutdown, forcing exit', {
          error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
