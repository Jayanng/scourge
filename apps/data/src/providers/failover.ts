import type { Fixture, MatchEvent, SportsProvider } from '../types.js';
import { RateLimitError } from './http.js';
import type pino from 'pino';

/**
 * Primary → fallback sports provider. On 429 / hard failures from primary,
 * automatically fail over to secondary for the rest of the process lifetime
 * (or until reset).
 */
export function createFailoverProvider(
  primary: SportsProvider | null,
  fallback: SportsProvider | null,
  log: pino.Logger,
): SportsProvider {
  let active: SportsProvider | null = primary ?? fallback;
  let usingFallback = !primary && !!fallback;

  function pick(): SportsProvider {
    if (!active) {
      throw new Error(
        'No sports provider configured (set API_FOOTBALL_KEY and/or FOOTBALL_DATA_KEY, or use REPLAY_MODE=1)',
      );
    }
    return active;
  }

  async function withFailover<T>(
    op: (p: SportsProvider) => Promise<T>,
    label: string,
  ): Promise<T> {
    const p = pick();
    try {
      return await op(p);
    } catch (e) {
      const isRate = e instanceof RateLimitError || String(e).includes('429');
      if (
        isRate &&
        !usingFallback &&
        fallback &&
        primary &&
        p.name === primary.name
      ) {
        log.warn({ err: String(e), label }, 'primary rate-limited — failing over');
        active = fallback;
        usingFallback = true;
        return op(fallback);
      }
      // try fallback on other primary failures once
      if (
        !usingFallback &&
        fallback &&
        primary &&
        p.name === primary.name
      ) {
        log.warn({ err: String(e), label }, 'primary failed — trying fallback');
        active = fallback;
        usingFallback = true;
        return op(fallback);
      }
      throw e;
    }
  }

  return {
    get name() {
      return pick().name;
    },
    fetchFixtures(from, to): Promise<Fixture[]> {
      return withFailover((p) => p.fetchFixtures(from, to), 'fixtures');
    },
    fetchLiveEvents(matchId): Promise<MatchEvent[]> {
      return withFailover((p) => p.fetchLiveEvents(matchId), 'liveEvents');
    },
  };
}
