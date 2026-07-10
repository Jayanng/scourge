import { z } from 'zod';

/** Redis channel payload: match.{matchId}.event */
export const MatchEventSchema = z.object({
  type: z.string(),
  minute: z.number().int().nonnegative(),
  player: z.string().optional(),
  team_id: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
  match_id: z.string().optional(),
  ts: z.number().optional(),
});

export type MatchEvent = z.infer<typeof MatchEventSchema>;

export interface Fixture {
  id: string;
  provider: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: Date | null;
  status: string;
  homeScore?: number;
  awayScore?: number;
  minute?: number | null;
  raw?: unknown;
}

export interface SportsProvider {
  name: string;
  fetchFixtures(from: string, to: string): Promise<Fixture[]>;
  fetchLiveEvents(matchId: string): Promise<MatchEvent[]>;
}
