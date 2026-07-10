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
