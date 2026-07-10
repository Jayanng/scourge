import { Redis } from 'ioredis';
import type { MatchEvent } from '../types.js';

export type RedisClient = Redis;

export function createRedis(url: string): RedisClient {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
}

export function eventChannel(matchId: string): string {
  return `match.${matchId}.event`;
}

export async function publishMatchEvent(
  redis: RedisClient,
  matchId: string,
  event: MatchEvent,
): Promise<void> {
  const payload = JSON.stringify({
    ...event,
    match_id: matchId,
    ts: event.ts ?? Date.now(),
  });
  await redis.publish(eventChannel(matchId), payload);
}
