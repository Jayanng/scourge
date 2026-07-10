/**
 * Deterministic market templates — NO LLM in the hot path (build plan §Prompt 5).
 */
import type { MarketTemplate } from '@kickoff/shared-types';

export interface MatchEvent {
  type: string;
  minute: number;
  player?: string;
  team_id?: string;
  extra?: Record<string, unknown>;
  match_id?: string;
}

export interface SpawnCandidate {
  template: MarketTemplate;
  question: string;
  closesAt: number;
  /** Dedup key within a match */
  key: string;
  meta: Record<string, unknown>;
}

export interface TemplateContext {
  matchId: string;
  event: MatchEvent;
  /** Templates already spawned for this match (keys) */
  spawnedKeys: Set<string>;
  /** State flags for the match */
  state: MatchState;
  nowSec: number;
}

export interface MatchState {
  kickoffDone: boolean;
  goals: number;
  yellows: number;
  corners: number;
  shotsOnTarget: number;
  firstYellowMinute: number | null;
}

export function emptyMatchState(): MatchState {
  return {
    kickoffDone: false,
    goals: 0,
    yellows: 0,
    corners: 0,
    shotsOnTarget: 0,
    firstYellowMinute: null,
  };
}

/** Update rolling match state from an event (pure, side-effect free). */
export function applyEvent(state: MatchState, event: MatchEvent): MatchState {
  const next = { ...state };
  const t = event.type.toLowerCase();
  if (t === 'kickoff' || t === 'start') next.kickoffDone = true;
  if (t === 'goal') next.goals += 1;
  if (t === 'corner') next.corners += 1;
  if (t === 'shot_on_target' || t === 'shot') next.shotsOnTarget += 1;
  if (t === 'yellow_card' || t === 'yellow') {
    next.yellows += 1;
    if (next.firstYellowMinute == null) next.firstYellowMinute = event.minute;
  }
  return next;
}

/**
 * Evaluate which markets to spawn for this event.
 * Rules are deterministic — templates only fire on matching events / state.
 */
export function evaluateTemplates(ctx: TemplateContext): SpawnCandidate[] {
  const { matchId, event, spawnedKeys, state, nowSec } = ctx;
  const out: SpawnCandidate[] = [];
  const t = event.type.toLowerCase();
  const minute = event.minute;

  const push = (c: SpawnCandidate) => {
    if (!spawnedKeys.has(c.key)) out.push(c);
  };

  // 1) match_winner — once at kickoff
  if (t === 'kickoff' || t === 'start') {
    push({
      template: 'match_winner',
      question: `Match ${matchId}: will the home team win?`,
      closesAt: nowSec + 90 * 60,
      key: `${matchId}:match_winner`,
      meta: { reason: 'kickoff' },
    });
  }

  // 2) next_goal_within — after any goal or kickoff, short window
  if (t === 'kickoff' || t === 'goal' || t === 'start') {
    const windowMin = 15;
    const key = `${matchId}:next_goal_within:${minute}`;
    push({
      template: 'next_goal_within',
      question: `Match ${matchId}: will there be a goal within the next ${windowMin} minutes (after min ${minute})?`,
      closesAt: nowSec + windowMin * 60,
      key,
      meta: { from_minute: minute, window_min: windowMin },
    });
  }

  // 3) corner_between_minutes — "impossible" micro-market around live minute
  //    Plan example: corner between min 34–36 — spawn when we approach that window
  //    or when a corner lands in a short band we open next band
  if (t === 'kickoff' || t === 'corner' || t === 'start') {
    const bandStart = Math.floor(minute / 3) * 3;
    // Prefer classic demo band when early in match
    const start = minute < 30 ? 34 : bandStart + 3;
    const end = start + 2;
    const key = `${matchId}:corner_between:${start}-${end}`;
    push({
      template: 'corner_between_minutes',
      question: `Match ${matchId}: corner kick between minute ${start} and ${end}?`,
      closesAt: nowSec + Math.max(60, (end - minute + 1) * 60),
      key,
      meta: { start, end, impossible_demo: start === 34 },
    });
  }

  // 4) player_sot_over — on shot_on_target for named player
  if (t === 'shot_on_target' || t === 'shot') {
    const player = event.player ?? 'Player';
    const line = 2;
    const key = `${matchId}:player_sot_over:${player}:${line}`;
    push({
      template: 'player_sot_over',
      question: `Match ${matchId}: will ${player} finish over ${line}.5 shots on target?`,
      closesAt: nowSec + 45 * 60,
      key,
      meta: { player, line },
    });
  }

  // 5) first_yellow_before — once near kickoff / early
  if (
    (t === 'kickoff' || t === 'start' || (t === 'yellow_card' && minute < 20)) &&
    state.firstYellowMinute == null
  ) {
    const before = 20;
    const key = `${matchId}:first_yellow_before:${before}`;
    push({
      template: 'first_yellow_before',
      question: `Match ${matchId}: first yellow card before minute ${before}?`,
      closesAt: nowSec + before * 60,
      key,
      meta: { before_minute: before },
    });
  }

  return out;
}
