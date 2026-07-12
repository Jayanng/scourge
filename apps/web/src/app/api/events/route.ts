import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Recent agent actions (the full swarm activity feed) from Postgres. */
export async function GET() {
  try {
    const res = await pool.query(
      `SELECT id, agent, action, match_id, market_id, payload, created_at
       FROM agent_actions ORDER BY created_at DESC LIMIT 300`,
    );
    return Response.json({ ok: true, actions: res.rows });
  } catch (e) {
    return Response.json({ ok: false, error: String(e), actions: [] });
  }
}
