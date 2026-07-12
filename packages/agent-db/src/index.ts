/**
 * Shared Postgres helpers for Kickoff agent persistence.
 *
 * Each agent previously copy-pasted this code. Now all oracles, resolvers,
 * and traders import from this single package. The bookmaker still adds its
 * own `insertMarket` and a wrapper that passes `'bookmaker'` as the agent.
 */
import pg from 'pg';

const { Pool } = pg;

export function createPool(databaseUrl: string): pg.Pool {
  return new Pool({ connectionString: databaseUrl });
}

export async function ensureAgentActionsTable(pool: pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS agent_actions (
      id SERIAL PRIMARY KEY,
      agent TEXT NOT NULL,
      action TEXT NOT NULL,
      match_id TEXT,
      market_id TEXT,
      payload JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

export async function insertAgentAction(
  pool: pg.Pool,
  row: {
    agent: string;
    action: string;
    matchId?: string;
    marketId?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO agent_actions (agent, action, match_id, market_id, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [
      row.agent,
      row.action,
      row.matchId ?? null,
      row.marketId ?? null,
      JSON.stringify(row.payload ?? {}),
    ],
  );
}
