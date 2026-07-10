/**
 * Thin wrapper over x402-fetch for agent-to-agent USDC micropayments.
 * Real x402 integration lands in Days 6–8 (Prompt 7).
 */

export type X402Mode = 'live' | 'mock';

export interface X402ClientConfig {
  mode: X402Mode;
  facilitatorUrl?: string;
  payTo?: string;
}

export function createX402Client(config: X402ClientConfig) {
  return {
    mode: config.mode,
    /** Skeleton: live path will use x402-fetch; mock uses in-memory ledger. */
    async pay(_url: string, _amount: string): Promise<{ ok: boolean; mode: X402Mode }> {
      return { ok: true, mode: config.mode };
    },
  };
}
