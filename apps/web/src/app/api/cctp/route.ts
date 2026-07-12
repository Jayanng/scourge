export const runtime = 'nodejs';

/**
 * CCTP onboarding stub (Prompt 9).
 *
 * Real flow: burn USDC on Base (via Circle's CCTP) → attestation → mint on
 * Injective → fund a Trader. The on-chain bridge is wired post-hackathon; this
 * endpoint returns a deterministic demo "burn" hash so the UX is exercisable
 * end-to-end. Clearly labelled as a stub in the UI.
 */
export async function POST(req: Request) {
  let body: { amount?: string; destination?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const amount = (body.amount ?? '').trim();
  const destination = (body.destination ?? '').trim();

  if (!/^\d+(\.\d+)?$/.test(amount)) {
    return Response.json({ ok: false, error: 'amount must be a number' }, { status: 400 });
  }
  if (!destination.startsWith('inj1')) {
    return Response.json({ ok: false, error: 'destination must be an inj1… address' }, { status: 400 });
  }

  const burnHash = `0x${Buffer.from(`${destination}:${amount}:${Date.now()}`).toString('hex').slice(0, 64)}`;
  return Response.json({
    ok: true,
    stub: true,
    message: 'CCTP burn simulated (bridge wiring pending)',
    amount,
    destination,
    burnHash,
    next: 'mint on Injective → fund Trader',
  });
}
