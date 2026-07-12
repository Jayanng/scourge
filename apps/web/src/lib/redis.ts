import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../../.env') });

export const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

export function newRedis(): Redis {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: 0, lazyConnect: true });
}
