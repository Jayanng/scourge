/**
 * Deterministic trading strategy for the Trader agents (Prompt 8).
 *
 * NO LLM. Each market template maps to a side and a default confidence; the
 * chosen persona (ronaldo9 = aggressive, var = conservative) scales stake and
 * latency. This mirrors how a quantified agent would express its edge without
 * calling out to a model in the hot path.
 */
import type { MarketTemplate } from '@kickoff/shared-types';

export type Persona = 'ronaldo9' | 'var';

export interface BetDecision {
  side: 'yes' | 'no';
  /** stake in micro-USDC (6dp), before persona scaling. */
  baseAmount: number;
  /** ms to wait before sending the bet (persona cadence). */
  delayMs: number;
  confidence: number;
  reason: string;
}

export interface DecisionContext {
  template: MarketTemplate | string;
  meta: Record<string, unknown>;
  /** Oracle consensus when known (from resolver signals). */
  consensus?: 'yes' | 'no' | 'void' | null;
}

export function isAggressive(persona: Persona): boolean {
  return persona === 'ronaldo9';
}

function templateDefault(ctx: DecisionContext): { side: 'yes' | 'no'; reason: string } {
  const now = Math.floor(Date.now() / 1000);
  const closesAt = Number(ctx.meta.closes_at ?? 0);
  const timeLeft = closesAt ? closesAt - now : 9999;

  switch (ctx.template) {
    case 'next_goal_within':
      // likely a goal in a 15m window of open play
      return { side: 'yes', reason: 'goal probability high in open window' };
    case 'corner_between_minutes': {
      const start = Number(ctx.meta.start ?? 0);
      const end = Number(ctx.meta.end ?? start + 2);
      const band = end - start;
      // narrow "impossible" demo bands are long shots
      if (band <= 2 && start >= 30) return { side: 'no', reason: 'tight corner band unlikely' };
      return { side: 'yes', reason: 'corners frequent in window' };
    }
    case 'first_yellow_before': {
      const before = Number(ctx.meta.before_minute ?? 20);
      if (before <= 20 && timeLeft > before * 60)
        return { side: 'yes', reason: 'early card likely' };
      return { side: 'no', reason: 'card window closing' };
    }
    case 'player_sot_over': {
      const line = Number(ctx.meta.line ?? 2);
      return line <= 2
        ? { side: 'yes', reason: 'striker usually clears low line' }
        : { side: 'no', reason: 'high SOT line' };
    }
    case 'match_winner':
      return { side: 'yes', reason: 'favour home/implied side' };
    default:
      return { side: 'yes', reason: 'default long' };
  }
}

export function decideBet(persona: Persona, ctx: DecisionContext): BetDecision {
  // If oracles already reached consensus, fade the crowd: take the other side
  // for value (aggressive) or simply follow consensus (conservative saver).
  const fallback = templateDefault(ctx);
  let side: 'yes' | 'no' = fallback.side;
  let reason: string = fallback.reason;

  if (ctx.consensus && ctx.consensus !== 'void') {
    if (isAggressive(persona)) {
      side = ctx.consensus === 'yes' ? 'no' : 'yes';
      reason = `fade oracle consensus ${ctx.consensus}`;
    } else {
      side = ctx.consensus;
      reason = `follow oracle consensus ${ctx.consensus}`;
    }
  }

  if (isAggressive(persona)) {
    return {
      side,
      baseAmount: 5000, // 0.005 USDC — fired fast
      delayMs: 300,
      confidence: 0.7,
      reason,
    };
  }
  return {
    side,
    baseAmount: 2000, // 0.002 USDC — smaller, patient
    delayMs: 1500,
    confidence: 0.55,
    reason,
  };
}
