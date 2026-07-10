import type { Db } from '../db/client.js';
import { events } from '../db/schema.js';
import { publishMatchEvent, type RedisClient } from '../redis/bus.js';
import type { MatchEvent, SportsProvider } from '../types.js';
import type pino from 'pino';
import { ensureMatchRow } from './fixtures.js';

/**
 * Poll live events every `intervalMs` for each match id and publish deltas to Redis.
 */
export function startLivePoller(opts: {
  matchIds: string[];
  provider: SportsProvider;
  redis: RedisClient;
  db: Db['db'];
  intervalMs: number;
  log: pino.Logger;
}): { stop: () => void } {
  const seen = new Map<string, Set<string>>(); // matchId → event keys
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const eventKey = (e: MatchEvent) =>
    `${e.type}|${e.minute}|${e.player ?? ''}|${e.team_id ?? ''}`;

  async function tick() {
    if (stopped) return;
    for (const matchId of opts.matchIds) {
      try {
        await ensureMatchRow(opts.db, matchId);
        const batch = await opts.provider.fetchLiveEvents(matchId);
        if (!seen.has(matchId)) seen.set(matchId, new Set());
        const known = seen.get(matchId)!;

        for (const ev of batch) {
          const key = eventKey(ev);
          if (known.has(key)) continue;
          known.add(key);

          await opts.db.insert(events).values({
            matchId,
            type: ev.type,
            minute: ev.minute,
            player: ev.player ?? null,
            teamId: ev.team_id ?? null,
            extra: ev.extra ?? null,
            source: opts.provider.name,
          });

          await publishMatchEvent(opts.redis, matchId, ev);
          opts.log.info(
            { matchId, type: ev.type, minute: ev.minute },
            'published match event',
          );
        }
      } catch (e) {
        opts.log.warn({ err: String(e), matchId }, 'live poll failed');
      }
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), opts.intervalMs);
    }
  }

  void tick();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
