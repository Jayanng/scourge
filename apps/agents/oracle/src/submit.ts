import type { OracleObservation } from '@kickoff/shared-types';
import type { X402Client } from '@kickoff/x402-client';

export interface SubmitResult {
  delivered: boolean;
  status?: number;
  error?: string;
  payment: { ok: boolean; mode: string };
}

export async function submitObservation(
  x402: X402Client,
  resolverUrl: string,
  obs: OracleObservation,
  opts: { timeoutMs?: number } = {},
): Promise<SubmitResult> {
  const endpoint = `${resolverUrl.replace(/\/$/, '')}/observe`;

  try {
    const res = await x402.fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(obs),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 4000),
    });
    return { delivered: res.ok, status: res.status, payment: { ok: true, mode: x402.mode } };
  } catch (e) {
    return { delivered: false, error: String(e), payment: { ok: false, mode: x402.mode } };
  }
}
