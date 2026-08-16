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
});

export const env = envSchema.parse(process.env);
