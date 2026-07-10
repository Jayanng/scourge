import type { Fixture, MatchEvent, SportsProvider } from '../types.js';
import { fetchWithBackoff, RateLimitError } from './http.js';

/**
 * football-data.org fallback provider.
 * Docs: https://www.football-data.org/documentation/api
 */
export function createFootballDataProvider(
  apiKey: string,
  baseUrl: string,
): SportsProvider {
  const headers = {
    'X-Auth-Token': apiKey,
    Accept: 'application/json',
  };

  return {
    name: 'football-data',

    async fetchFixtures(from: string, to: string): Promise<Fixture[]> {
      const url = `${baseUrl}/matches?dateFrom=${from}&dateTo=${to}`;
      const res = await fetchWithBackoff(
        url,
        { headers },
        { label: 'football-data matches' },
      );
      if (!res.ok) {
        if (res.status === 429) throw new RateLimitError('football-data 429');
        throw new Error(`football-data matches HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        matches?: Array<{
          id: number;
          utcDate: string;
          status: string;
          minute?: number | null;
          homeTeam: { name: string; id: number };
          awayTeam: { name: string; id: number };
          score: {
            fullTime: { home: number | null; away: number | null };
          };
        }>;
      };

      return (body.matches ?? []).map((m) => ({
        id: String(m.id),
        provider: 'football-data',
        homeTeam: m.homeTeam.name,
        awayTeam: m.awayTeam.name,
        kickoffAt: m.utcDate ? new Date(m.utcDate) : null,
        status: m.status,
        homeScore: m.score?.fullTime?.home ?? 0,
        awayScore: m.score?.fullTime?.away ?? 0,
        minute: m.minute ?? null,
        raw: m,
      }));
    },

    async fetchLiveEvents(matchId: string): Promise<MatchEvent[]> {
      // football-data free tier has limited live events; use match detail goals
      const url = `${baseUrl}/matches/${matchId}`;
      const res = await fetchWithBackoff(
        url,
        { headers },
        { label: 'football-data match' },
      );
      if (!res.ok) {
        if (res.status === 429) throw new RateLimitError('football-data 429');
        throw new Error(`football-data match HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        minute?: number;
        goals?: Array<{
          minute: number;
          scorer?: { name: string };
          team?: { id: number; name: string };
          type?: string;
        }>;
        bookings?: Array<{
          minute: number;
          player?: { name: string };
          team?: { id: number };
          card?: string;
        }>;
      };

      const events: MatchEvent[] = [];
      for (const g of body.goals ?? []) {
        events.push({
          type: 'goal',
          minute: g.minute ?? 0,
          player: g.scorer?.name,
          team_id: g.team?.id != null ? String(g.team.id) : undefined,
          extra: { team_name: g.team?.name, provider: 'football-data' },
        });
      }
      for (const b of body.bookings ?? []) {
        events.push({
          type: (b.card ?? 'yellow').toLowerCase().includes('red')
            ? 'red_card'
            : 'yellow_card',
          minute: b.minute ?? 0,
          player: b.player?.name,
          team_id: b.team?.id != null ? String(b.team.id) : undefined,
          extra: { provider: 'football-data' },
        });
      }
      return events;
    },
  };
}
