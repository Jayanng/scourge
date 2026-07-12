/**
 * Deliver a signed observation to the Resolver, paying via x402 first.
 *
 * The Resolver's `/observe` endpoint arrives in Prompt 7. Until then this
 * fails soft: the x402 payment is still recorded and the observation is still
 * published to Redis by the caller for demo visibility.
 */
import { fetch } from 'undici';
import type { OracleObservation } from '@kickoff/shared-types';

export interface X402Like {
  mode: string;
  pay(url: string, amount: string): Promise<{ ok: boolean; mode: string }>;
}

export interface SubmitResult {
  delivered: boolean;
  status?: number;
  error?: string;
  payment: { ok: boolean; mode: string };
}

export async function submitObservation(
  x402: X402Like,
  resolverUrl: string,
  obs: OracleObservation,
  opts: { amount?: string; timeoutMs?: number } = {},
): Promise<SubmitResult> {
  const endpoint = `${resolverUrl.replace(/\/$/, '')}/observe`;
  const amount = opts.amount ?? '1000'; // 0.001 USDC (6dp) subscription fee

  // Pay the resolver for consuming the observation (agent-to-agent economy).
  const payment = await x402.pay(endpoint, amount);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(obs),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 4000),
    });
    return { delivered: res.ok, status: res.status, payment };
  } catch (e) {
    return { delivered: false, error: String(e), payment };
  }
}
