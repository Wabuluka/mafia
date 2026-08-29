import 'dotenv/config';
import { z } from 'zod';

// Fail fast at boot if config is missing/malformed rather than surfacing a
// confusing runtime error deep inside a socket handler later.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  MONGO_URI: z.string().min(1).default('mongodb://localhost:27017/mafia'),
  MONGO_MAX_POOL_SIZE: z.coerce.number().int().positive().default(20),
  MONGO_MIN_POOL_SIZE: z.coerce.number().int().nonnegative().default(1),
  MONGO_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SESSION_SECRET: z.string().min(1).default('dev-secret-change-me'),
  // Optional bearer token gating GET /metrics (see metrics.routes.ts). Left
  // unset, the endpoint stays open — fine for local dev, but it's an
  // unauthenticated, unrate-limited enumeration surface (active
  // villages/players/games), so production deployments should set this.
  METRICS_TOKEN: z.string().min(1).optional(),
});

export const env = envSchema.parse(process.env);

// The session cookie is signed with SESSION_SECRET and, once issued, IS the
// auth credential for both HTTP and the WebSocket handshake (see session.ts /
// socketAuth.ts). Booting production with the checked-in dev default would
// let anyone forge a valid session for any player, so refuse to start rather
// than silently running insecure.
if (env.NODE_ENV === 'production') {
  if (env.SESSION_SECRET === 'dev-secret-change-me') {
    throw new Error(
      'SESSION_SECRET must be set to a real secret in production (refusing to boot with the dev default).'
    );
  }
  if (env.SESSION_SECRET.length < 32) {
    throw new Error(
      'SESSION_SECRET must be at least 32 characters in production for adequate signing entropy.'
    );
  }
}
