/**
 * Shared Zod schemas and TypeScript types for Kickoff Protocol.
 * Business logic will land in later prompts — skeleton exports only.
 */

export const PACKAGE_NAME = '@kickoff/shared-types' as const;

/** Placeholder re-export surface for market / agent / event types. */
export type Side = 'yes' | 'no';
export type Outcome = 'yes' | 'no' | 'void';
export type MarketTemplate =
  | 'match_winner'
  | 'next_goal_within'
  | 'corner_between_minutes'
  | 'player_sot_over'
  | 'first_yellow_before';

/**
 * A market the Oracle/Resolver track for observation & settlement.
 * Mirrors the bookmaker's create_market call plus the on-chain address.
 */
export interface TrackedMarket {
  /** Contract address (inj1…) or a mock_ id in dry-run. */
  market: string;
  match_id: string;
  template: MarketTemplate | string;
  question: string;
  /** Unix seconds when betting closes / market can be resolved. */
  closes_at: number;
  /** Template parameters (start/end minute, player, line, etc.). */
  meta: Record<string, unknown>;
}

/**
 * A single oracle's signed opinion about a market's outcome.
 * Oracles POST these to the Resolver (via x402); the Resolver applies
 * 2-of-3 consensus (Prompt 7) before settling on-chain.
 */
export interface OracleObservation {
  market: string;
  match_id: string;
  template: MarketTemplate | string;
  outcome: Outcome;
  /** Human/machine-readable evidence reference. */
  evidence_url: string;
  /** Unix milliseconds the observation was made. */
  observed_at: number;
  /** Oracle identity, e.g. "oracle-1". */
  oracle: string;
  /** Oracle instance number (1|2|3). */
  instance: number;
  /** HMAC-SHA256 over the canonical observation string. */
  signature: string;
}
