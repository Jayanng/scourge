import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Latest markets from Postgres, newest first. */
export async function GET() {
  try {
    const res = await pool.query(
      `SELECT id, contract_address, match_id, template, question, closes_at, status, meta, created_at
       FROM markets ORDER BY created_at DESC LIMIT 200`,
    );
    return Response.json({ ok: true, markets: res.rows });
  } catch (e) {
    return Response.json({ ok: false, error: String(e), markets: [] });
  }
}
