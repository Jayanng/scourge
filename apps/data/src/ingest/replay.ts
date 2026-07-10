import { readFile } from 'node:fs/promises';
import type { Db } from '../db/client.js';
import { events } from '../db/schema.js';
import { publishMatchEvent, type RedisClient } from '../redis/bus.js';
import type { MatchEvent } from '../types.js';
import type pino from 'pino';
import { ensureMatchRow } from './fixtures.js';
import { sleep } from '../providers/http.js';

export interface ReplayFile {
  match_id: string;
  home_team?: string;
  away_team?: string;
  events: Array<MatchEvent & { delay_ms?: number }>;
}

/**
 * REPLAY_MODE: read events from JSON and republish with realistic spacing.
 */
export async function runReplay(opts: {
  filePath: string;
  redis: RedisClient;
  db: Db['db'];
  speed: number;
  log: pino.Logger;
  loop?: boolean;
}): Promise<{ stop: () => void }> {
  let stopped = false;

  const runOnce = async () => {
    const raw = await readFile(opts.filePath, 'utf8');
    const data = JSON.parse(raw) as ReplayFile;
    const matchId = data.match_id;
    await ensureMatchRow(
      opts.db,
      matchId,
      data.home_team ?? 'Team A',
      data.away_team ?? 'Team B',
    );

    opts.log.info(
      { matchId, events: data.events.length, file: opts.filePath, speed: opts.speed },
      'replay starting',
    );

    for (const ev of data.events) {
      if (stopped) return;
      const delay = Math.max(0, Math.floor((ev.delay_ms ?? 1500) / opts.speed));
      if (delay > 0) await sleep(delay);

      const event: MatchEvent = {
        type: ev.type,
        minute: ev.minute,
        player: ev.player,
        team_id: ev.team_id,
        extra: { ...ev.extra, replay: true },
      };

      await opts.db.insert(events).values({
        matchId,
        type: event.type,
        minute: event.minute,
        player: event.player ?? null,
        teamId: event.team_id ?? null,
        extra: event.extra ?? null,
        source: 'replay',
      });

      await publishMatchEvent(opts.redis, matchId, event);
      opts.log.info(
        { matchId, type: event.type, minute: event.minute },
        'replay event published',
      );
    }

    opts.log.info({ matchId }, 'replay finished');
  };

  const loop = async () => {
    do {
      await runOnce();
      if (opts.loop && !stopped) {
        opts.log.info('replay looping');
        await sleep(2000);
      }
    } while (opts.loop && !stopped);
  };

  void loop().catch((e) => opts.log.error(e, 'replay failed'));

  return {
    stop() {
      stopped = true;
    },
  };
}
