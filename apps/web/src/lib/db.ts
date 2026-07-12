import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../../.env') });

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://kickoff:kickoff@localhost:5432/kickoff';

const globalForPg = globalThis as unknown as { __kickoffPg?: pg.Pool };
export const pool: pg.Pool = globalForPg.__kickoffPg ?? new pg.Pool({ connectionString });
if (!globalForPg.__kickoffPg) globalForPg.__kickoffPg = pool;
