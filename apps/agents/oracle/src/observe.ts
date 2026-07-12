/**
 * Deterministic outcome resolution for the Oracle agent (Prompt 6).
 *
 * Oracles do NOT use an LLM. They accumulate a pure view of match state from
 * the Redis `match.*.event` stream and resolve each tracked market with the
 * exact same rules the Bookmaker used to spawn it (see bookmaker/templates.ts).
 */
import type { Outcome, TrackedMarket } from '@kickoff/shared-types';

export interface MatchEvent {
  type: string;
  minute: number;
  player?: string;
  team_id?: string;
  extra?: Record<string, unknown>;
  match_id?: string;
  ts?: number;
}

/** Pure, append-only view of everything observed for a single match. */
export interface MatchObs {
  /** Highest minute seen so far. */
  minute: number;
  fullTime: boolean;
  goals: Array<{ minute: number; team_id?: string }>;
  corners: Array<{ minute: number }>;
  yellows: Array<{ minute: number }>;
  /** shots on target keyed by player name. */
  sotByPlayer: Record<string, number>;
  /** goals keyed by team_id. */
  scoreByTeam: Record<string, number>;
}

export function emptyMatchObs(): MatchObs {
  return {
    minute: 0,
    fullTime: false,
    goals: [],
    corners: [],
    yellows: [],
    sotByPlayer: {},
    scoreByTeam: {},
  };
}

/** Fold an event into match observations (mutates + returns for convenience). */
export function applyEvent(obs: MatchObs, event: MatchEvent): MatchObs {
  const t = event.type.toLowerCase();
  if (Number.isFinite(event.minute)) {
    obs.minute = Math.max(obs.minute, event.minute);
  }

  if (t === 'goal') {
    obs.goals.push({ minute: event.minute, team_id: event.team_id });
    if (event.team_id) {
      obs.scoreByTeam[event.team_id] = (obs.scoreByTeam[event.team_id] ?? 0) + 1;
    }
  } else if (t === 'corner') {
    obs.corners.push({ minute: event.minute });
  } else if (t === 'yellow_card' || t === 'yellow') {
    obs.yellows.push({ minute: event.minute });
  } else if (t === 'shot_on_target' || t === 'shot') {
    const p = event.player ?? 'Player';
    obs.sotByPlayer[p] = (obs.sotByPlayer[p] ?? 0) + 1;
  } else if (t === 'full_time' || t === 'ft' || t === 'match_end') {
    obs.fullTime = true;
  }
  return obs;
}

export interface Resolution {
  decided: boolean;
  outcome?: Outcome;
  reason: string;
}

const UNDECIDED: Resolution = { decided: false, reason: 'waiting for more events' };

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Resolve a single market against the current match observation.
 *
 * `nowSec` lets time-based markets settle at `closes_at` even if no further
 * events arrive. Returns `decided: false` when the outcome is not yet certain.
 */
export function resolveMarket(
  market: TrackedMarket,
  obs: MatchObs,
  nowSec: number,
): Resolution {
  const meta = market.meta ?? {};
  const timeUp = nowSec >= market.closes_at;
  const ended = obs.fullTime;

  switch (market.template) {
    case 'next_goal_within': {
      const from = num(meta.from_minute, 0);
      const windowMin = num(meta.window_min, 15);
      const until = from + windowMin;
      const hit = obs.goals.some((g) => g.minute > from && g.minute <= until);
      if (hit) return { decided: true, outcome: 'yes', reason: `goal within ${windowMin}m of min ${from}` };
      if (obs.minute > until || ended || timeUp)
        return { decided: true, outcome: 'no', reason: `no goal by min ${until}` };
      return UNDECIDED;
    }

    case 'corner_between_minutes': {
      const start = num(meta.start, 0);
      const end = num(meta.end, start + 2);
      const hit = obs.corners.some((c) => c.minute >= start && c.minute <= end);
      if (hit) return { decided: true, outcome: 'yes', reason: `corner in [${start}, ${end}]` };
      if (obs.minute > end || ended || timeUp)
        return { decided: true, outcome: 'no', reason: `no corner in [${start}, ${end}]` };
      return UNDECIDED;
    }

    case 'first_yellow_before': {
      const before = num(meta.before_minute, 20);
      const earliest = obs.yellows.length
        ? Math.min(...obs.yellows.map((y) => y.minute))
        : null;
      if (earliest != null && earliest < before)
        return { decided: true, outcome: 'yes', reason: `first yellow at min ${earliest}` };
      if (obs.minute >= before || ended || timeUp)
        return { decided: true, outcome: 'no', reason: `no yellow before min ${before}` };
      return UNDECIDED;
    }

    case 'player_sot_over': {
      const player = String(meta.player ?? 'Player');
      const line = num(meta.line, 2);
      const count = obs.sotByPlayer[player] ?? 0;
      if (count > line)
        return { decided: true, outcome: 'yes', reason: `${player} SOT=${count} > ${line}.5` };
      if (ended || timeUp)
        return { decided: true, outcome: 'no', reason: `${player} SOT=${count} <= ${line}.5 at end` };
      return UNDECIDED;
    }

    case 'match_winner': {
      // "will the home team win?" — resolvable only at full time / close.
      if (!(ended || timeUp)) return UNDECIDED;
      const homeId = meta.home_team_id != null ? String(meta.home_team_id) : null;
      const awayId = meta.away_team_id != null ? String(meta.away_team_id) : null;
      if (!homeId) return { decided: true, outcome: 'void', reason: 'home team unknown' };
      const home = obs.scoreByTeam[homeId] ?? 0;
      const away = awayId
        ? obs.scoreByTeam[awayId] ?? 0
        : Object.entries(obs.scoreByTeam)
            .filter(([k]) => k !== homeId)
            .reduce((s, [, v]) => s + v, 0);
      if (home > away) return { decided: true, outcome: 'yes', reason: `home won ${home}-${away}` };
      return { decided: true, outcome: 'no', reason: `home did not win ${home}-${away}` };
    }

    default: {
      // Unknown template — only void at close so we never block the resolver.
      if (ended || timeUp)
        return { decided: true, outcome: 'void', reason: `unknown template ${market.template}` };
      return UNDECIDED;
    }
  }
}
