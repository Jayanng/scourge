import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

export type Db = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Idempotent bootstrap SQL (no drizzle-kit required at runtime). */
export async function migrate(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL DEFAULT 'unknown',
      home_team TEXT NOT NULL,
      away_team TEXT NOT NULL,
      kickoff_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'scheduled',
      minute INTEGER,
      home_score INTEGER DEFAULT 0,
      away_score INTEGER DEFAULT 0,
      raw JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      match_id TEXT NOT NULL REFERENCES matches(id),
      type TEXT NOT NULL,
      minute INTEGER NOT NULL,
      player TEXT,
      team_id TEXT,
      extra JSONB,
      source TEXT NOT NULL DEFAULT 'live',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS markets (
      id SERIAL PRIMARY KEY,
      contract_address TEXT,
      match_id TEXT REFERENCES matches(id),
      template TEXT NOT NULL,
      question TEXT NOT NULL,
      closes_at INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      meta JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS agent_actions (
      id SERIAL PRIMARY KEY,
      agent TEXT NOT NULL,
      action TEXT NOT NULL,
      match_id TEXT,
      market_id TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS events_match_id_idx ON events(match_id);
    CREATE INDEX IF NOT EXISTS agent_actions_agent_idx ON agent_actions(agent);
  `);
}
