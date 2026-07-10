import pg from 'pg';

const { Pool } = pg;

export function createPool(databaseUrl: string) {
  return new Pool({ connectionString: databaseUrl });
}

export async function ensureTables(pool: pg.Pool): Promise<void> {
  // Idempotent — data service may already have created these
  await pool.query(`
    CREATE TABLE IF NOT EXISTS markets (
      id SERIAL PRIMARY KEY,
      contract_address TEXT,
      match_id TEXT,
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
  `);
}

export async function insertMarket(
  pool: pg.Pool,
  row: {
    contractAddress?: string;
    matchId: string;
    template: string;
    question: string;
    closesAt: number;
    meta?: Record<string, unknown>;
  },
): Promise<number> {
  const res = await pool.query(
    `INSERT INTO markets (contract_address, match_id, template, question, closes_at, status, meta)
     VALUES ($1,$2,$3,$4,$5,'open',$6) RETURNING id`,
    [
      row.contractAddress ?? null,
      row.matchId,
      row.template,
      row.question,
      row.closesAt,
      JSON.stringify(row.meta ?? {}),
    ],
  );
  return res.rows[0].id as number;
}

export async function insertAgentAction(
  pool: pg.Pool,
  row: {
    action: string;
    matchId?: string;
    marketId?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO agent_actions (agent, action, match_id, market_id, payload)
     VALUES ('bookmaker',$1,$2,$3,$4)`,
    [
      row.action,
      row.matchId ?? null,
      row.marketId ?? null,
      JSON.stringify(row.payload ?? {}),
    ],
  );
}
