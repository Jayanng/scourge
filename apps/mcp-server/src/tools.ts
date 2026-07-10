import { z } from 'zod';
import type { InjClient } from '@kickoff/inj-client';

export const CreateMarketInput = z.object({
  question: z.string().min(1),
  closes_at: z.number().int().positive(),
  match_id: z.string().min(1),
  template: z.string().min(1),
});

export const PlaceBetInput = z.object({
  market: z.string().regex(/^inj1[a-z0-9]+$/),
  side: z.enum(['yes', 'no']),
  amount: z.string().regex(/^\d+$/),
});

export const SubmitObservationInput = z.object({
  market: z.string().regex(/^inj1[a-z0-9]+$/),
  outcome: z.enum(['yes', 'no', 'void']),
  evidence_url: z.string().url().or(z.string().min(1)),
  signature: z.string().min(1),
});

export const SettleMarketInput = z.object({
  market: z.string().regex(/^inj1[a-z0-9]+$/),
  outcome: z.enum(['yes', 'no', 'void']),
});

export const ClaimInput = z.object({
  market: z.string().regex(/^inj1[a-z0-9]+$/),
});

/** In-memory observation buffer until Resolver agent (Prompt 7) owns consensus. */
const observations = new Map<
  string,
  Array<{
    outcome: 'yes' | 'no' | 'void';
    evidence_url: string;
    signature: string;
    at: number;
  }>
>();

export function getObservations(market: string) {
  return observations.get(market) ?? [];
}

export async function handleCreateMarket(
  client: InjClient,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = CreateMarketInput.parse(raw);
  const res = await client.createMarket(input.question, input.closes_at, {
    matchId: input.match_id,
    template: input.template,
  });
  return {
    ok: true,
    tool: 'create_market',
    ...res,
    match_id: input.match_id,
    template: input.template,
    question: input.question,
    closes_at: input.closes_at,
  };
}

export async function handlePlaceBet(
  client: InjClient,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = PlaceBetInput.parse(raw);
  const res = await client.placeBet(input.market, input.side, input.amount);
  return { ok: true, tool: 'place_bet', ...res, ...input };
}

export async function handleSubmitObservation(
  _client: InjClient,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = SubmitObservationInput.parse(raw);
  const list = observations.get(input.market) ?? [];
  list.push({
    outcome: input.outcome,
    evidence_url: input.evidence_url,
    signature: input.signature,
    at: Date.now(),
  });
  observations.set(input.market, list);

  // Lightweight 2-of-3 tally for demo visibility (Resolver settles on-chain)
  const windowMs = 30_000;
  const cutoff = Date.now() - windowMs;
  const recent = list.filter((o) => o.at >= cutoff);
  const counts: Record<string, number> = {};
  for (const o of recent) {
    counts[o.outcome] = (counts[o.outcome] ?? 0) + 1;
  }
  let consensus: string | null = null;
  for (const [outcome, n] of Object.entries(counts)) {
    if (n >= 2) consensus = outcome;
  }

  return {
    ok: true,
    tool: 'submit_observation',
    market: input.market,
    outcome: input.outcome,
    observations_in_window: recent.length,
    consensus,
    note:
      consensus != null
        ? '2-of-3 consensus reached off-chain — call settle_market'
        : 'waiting for 2-of-3 oracle agreement within 30s',
  };
}

export async function handleSettleMarket(
  client: InjClient,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = SettleMarketInput.parse(raw);
  const res = await client.settleMarket(input.market, input.outcome);
  return { ok: true, tool: 'settle_market', ...res, ...input };
}

export async function handleClaim(
  client: InjClient,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const input = ClaimInput.parse(raw);
  const res = await client.claim(input.market);
  return { ok: true, tool: 'claim', ...res, market: input.market };
}
