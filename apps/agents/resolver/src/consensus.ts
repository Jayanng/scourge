/**
 * 2-of-3 oracle consensus for the Resolver (Prompt 7).
 *
 * Observations arrive from the three oracles (signed with a shared HMAC
 * secret). We verify each signature before counting it, then settle a market
 * once >= 2 *verified* oracles agree on the same outcome.
 */
import type { OracleObservation } from '@kickoff/shared-types';
import { verifyObservation } from '@kickoff/agent-oracle/sign';

export const CONSENSUS_THRESHOLD = 2;

export interface Bundle {
  market: string;
  matchId: string;
  template: string;
  observations: OracleObservation[];
  settled: boolean;
  consensus: 'yes' | 'no' | 'void' | null;
  winners: number[];
  settledAt: number | null;
}

export class Consensus {
  private bundles = new Map<string, Bundle>();
  private secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  /** Ingest one observation, verifying its signature. Returns null if invalid. */
  ingest(o: OracleObservation): OracleObservation | null {
    if (!verifyObservation(o, this.secret)) return null;
    const bundle =
      this.bundles.get(o.market) ??
      ({
        market: o.market,
        matchId: o.match_id,
        template: o.template,
        observations: [],
        settled: false,
        consensus: null,
        winners: [],
        settledAt: null,
      } satisfies Bundle);
    // keep latest report per (market, instance)
    const i = bundle.observations.findIndex((e) => e.instance === o.instance);
    if (i >= 0) bundle.observations[i] = o;
    else bundle.observations.push(o);
    this.bundles.set(o.market, bundle);
    return o;
  }

  /** Recompute consensus. Returns the winning outcome once threshold met. */
  evaluate(market: string): {
    consensus: 'yes' | 'no' | 'void' | null;
    verified: number;
    breakdown: Record<string, number>;
  } {
    const bundle = this.bundles.get(market);
    if (!bundle || bundle.settled) {
      const b = bundle;
      return {
        consensus: b?.consensus ?? null,
        verified: b?.observations.length ?? 0,
        breakdown: {},
      };
    }
    const verified = bundle.observations.length;
    const breakdown: Record<string, number> = {};
    for (const o of bundle.observations) {
      breakdown[o.outcome] = (breakdown[o.outcome] ?? 0) + 1;
    }
    for (const [outcome, n] of Object.entries(breakdown)) {
      if (n >= CONSENSUS_THRESHOLD) {
        bundle.consensus = outcome as Bundle['consensus'];
        return { consensus: bundle.consensus, verified, breakdown };
      }
    }
    return { consensus: null, verified, breakdown };
  }

  markSettled(market: string, consensus: 'yes' | 'no' | 'void', winners: number[]) {
    const bundle = this.bundles.get(market);
    if (!bundle) return;
    bundle.settled = true;
    bundle.consensus = consensus;
    bundle.winners = winners;
    bundle.settledAt = Date.now();
  }

  get(market: string): Bundle | undefined {
    return this.bundles.get(market);
  }

  all(): Bundle[] {
    return [...this.bundles.values()];
  }
}
