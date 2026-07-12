import { placeBetViaMcp } from '@/lib/mcp';

export const runtime = 'nodejs';

/** Place a bet through the MCP server (sole key-holder). Body: { market, side, amount }. */
export async function POST(req: Request) {
  let body: { market?: string; side?: string; amount?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const market = (body.market ?? '').trim();
  const side = body.side === 'yes' || body.side === 'no' ? body.side : null;
  const amount = (body.amount ?? '').trim();

  if (!market || !side || !/^\d+$/.test(amount)) {
    return Response.json(
      { ok: false, error: 'market (inj1…), side (yes|no), amount (integer micro-USDC) required' },
      { status: 400 },
    );
  }

  try {
    const r = await placeBetViaMcp(market, side, amount);
    return Response.json({ ok: r.ok, text: r.text, error: r.error });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
