import type { Fixture, MatchEvent, SportsProvider } from '../types.js';
import { fetchWithBackoff, RateLimitError } from './http.js';

/**
 * api-football.com (API-Sports) primary provider.
 * Docs: https://www.api-football.com/documentation-v3
 */
export function createApiFootballProvider(
  apiKey: string,
  baseUrl: string,
): SportsProvider {
  const headers = {
    'x-apisports-key': apiKey,
    Accept: 'application/json',
  };

  return {
    name: 'api-football',

    async fetchFixtures(from: string, to: string): Promise<Fixture[]> {
      // World Cup / summer window — also pull by date range across leagues
      const url = `${baseUrl}/fixtures?from=${from}&to=${to}`;
      const res = await fetchWithBackoff(
        url,
        { headers },
        { label: 'api-football fixtures' },
      );
      if (!res.ok) {
        if (res.status === 429) throw new RateLimitError('api-football 429');
        throw new Error(`api-football fixtures HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        response?: Array<{
          fixture: {
            id: number;
            date: string;
            status: { short: string; elapsed: number | null };
          };
          teams: { home: { name: string }; away: { name: string } };
          goals: { home: number | null; away: number | null };
        }>;
        errors?: unknown;
      };

      const rows = body.response ?? [];
      return rows.map((r) => ({
        id: String(r.fixture.id),
        provider: 'api-football',
        homeTeam: r.teams.home.name,
        awayTeam: r.teams.away.name,
        kickoffAt: r.fixture.date ? new Date(r.fixture.date) : null,
        status: r.fixture.status?.short ?? 'NS',
        homeScore: r.goals.home ?? 0,
        awayScore: r.goals.away ?? 0,
        minute: r.fixture.status?.elapsed ?? null,
        raw: r,
      }));
    },

    async fetchLiveEvents(matchId: string): Promise<MatchEvent[]> {
      const url = `${baseUrl}/fixtures/events?fixture=${matchId}`;
      const res = await fetchWithBackoff(
        url,
        { headers },
        { label: 'api-football events' },
      );
      if (!res.ok) {
        if (res.status === 429) throw new RateLimitError('api-football 429');
        throw new Error(`api-football events HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        response?: Array<{
          time: { elapsed: number | null; extra: number | null };
          team: { id: number; name: string };
          player: { id: number | null; name: string | null };
          type: string;
          detail: string;
        }>;
      };

      return (body.response ?? []).map((e) => ({
        type: normalizeType(e.type, e.detail),
        minute: e.time.elapsed ?? 0,
        player: e.player?.name ?? undefined,
        team_id: e.team?.id != null ? String(e.team.id) : undefined,
        extra: {
          detail: e.detail,
          extra_minute: e.time.extra,
          team_name: e.team?.name,
          provider: 'api-football',
        },
      }));
    },
  };
}

function normalizeType(type: string, detail: string): string {
  const t = `${type} ${detail}`.toLowerCase();
  if (t.includes('goal')) return 'goal';
  if (t.includes('card') && t.includes('yellow')) return 'yellow_card';
  if (t.includes('card') && t.includes('red')) return 'red_card';
  if (t.includes('corner')) return 'corner';
  if (t.includes('subst')) return 'substitution';
  if (t.includes('var')) return 'var';
  return type.toLowerCase().replace(/\s+/g, '_') || 'unknown';
}
