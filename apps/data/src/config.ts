import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: resolve(root, '.env') });

const Env = z.object({
  DATA_PORT: z.coerce.number().default(4001),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  DATABASE_URL: z
    .string()
    .default('postgres://kickoff:kickoff@localhost:5432/kickoff'),
  REPLAY_MODE: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  REPLAY_FILE: z.string().optional(),
  REPLAY_SPEED: z.coerce.number().default(1),
  LIVE_MATCH_IDS: z.string().default(''),
  FIXTURE_FROM: z.string().default('2026-07-03'),
  FIXTURE_TO: z.string().default('2026-07-19'),
  POLL_INTERVAL_MS: z.coerce.number().default(15_000),
  API_FOOTBALL_KEY: z.string().optional().default(''),
  API_FOOTBALL_BASE: z
    .string()
    .default('https://v3.football.api-sports.io'),
  FOOTBALL_DATA_KEY: z.string().optional().default(''),
  FOOTBALL_DATA_BASE: z.string().default('https://api.football-data.org/v4'),
  SKIP_FIXTURE_PULL: z
    .string()
    .optional()
    .transform((v) => v === '1' || v === 'true'),
});

export type AppConfig = z.infer<typeof Env> & {
  liveMatchIds: string[];
};

export function loadConfig(): AppConfig {
  const parsed = Env.parse(process.env);
  const liveMatchIds = parsed.LIVE_MATCH_IDS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { ...parsed, liveMatchIds };
}
