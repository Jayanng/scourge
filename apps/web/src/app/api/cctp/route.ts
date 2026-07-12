export const runtime = 'nodejs';

/**
 * CCTP onboarding endpoint.
 *
 * Two modes:
 *   mock (default) — returns a deterministic fake burn hash for UI testing.
 *   live            — accepts a real burn tx hash from Base Sepolia, polls
 *                     Circle's attestation API, and returns the attestation.
 *
 * POST body (mock):  { amount, destination }
 * POST body (live):  { burnTxHash, amount, destination }
 */

interface CctpBody {
  amount?: string;
  destination?: string;
  burnTxHash?: string;
  mode?: 'mock' | 'live';
}

// Circle Attestation API — testnet
const IRIS_API = process.env.CCTP_IRIS_API ?? 'https://iris-api-sandbox.circle.com';

export async function POST(req: Request) {
  let body: CctpBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const amount = (body.amount ?? '').trim();
  const destination = (body.destination ?? '').trim();
  const mode = body.mode === 'live' ? 'live' : 'mock';

  if (!/^\d+(\.\d+)?$/.test(amount)) {
    return Response.json({ ok: false, error: 'amount must be a number' }, { status: 400 });
  }
  if (!destination.startsWith('inj1')) {
    return Response.json({ ok: false, error: 'destination must be an inj1… address' }, { status: 400 });
  }

  // ---- MOCK MODE ----
  if (mode === 'mock') {
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

  // ---- LIVE MODE ----
  const burnTxHash = (body.burnTxHash ?? '').trim();
  if (!burnTxHash.startsWith('0x')) {
    return Response.json({ ok: false, error: 'burnTxHash is required in live mode' }, { status: 400 });
  }

  // Poll Circle's attestation API for the burn
  const attestationUrl = `${IRIS_API}/v1/attestations?txHash=${burnTxHash}`;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const searchRes = await fetch(attestationUrl);
      if (searchRes.ok) {
        const searchData = (await searchRes.json()) as {
          attestations?: Array<{ messageHash: string; status: string; attestation?: string }>;
        };
        if (searchData.attestations && searchData.attestations.length > 0) {
          const att = searchData.attestations[0];
          const ready = att.status === 'complete' && att.attestation;
          return Response.json({
            ok: true,
            stub: false,
            message: ready ? 'Attestation ready — mint on Injective' : 'Attestation pending — try again shortly',
            amount,
            destination,
            burnTxHash,
            messageHash: att.messageHash,
            attestation: att.attestation ?? null,
            attestationStatus: att.status,
            next: ready
              ? `node scripts/cctp-mint.mjs "${att.attestation}" "${destination}" "${amount}"`
              : 'Wait for attestation to complete, then retry this endpoint',
          });
        }
      }
    } catch {
      // network error, retry
    }
    if (attempt < 4) await new Promise((r) => setTimeout(r, 2000));
  }

  return Response.json({
    ok: true,
    stub: false,
    message: 'Burn submitted — attestation not yet available. Circle typically takes 3-5 minutes.',
    amount,
    destination,
    burnTxHash,
    attestationUrl,
    next: 'Check the attestation URL above, then run: node scripts/cctp-mint.mjs <attestation> <destination> <amount>',
  });
}
