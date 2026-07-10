import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { matches } from '../db/schema.js';
import type { SportsProvider } from '../types.js';
import type pino from 'pino';

export async function pullAndStoreFixtures(
  db: Db['db'],
  provider: SportsProvider,
  from: string,
  to: string,
  log: pino.Logger,
): Promise<number> {
  const fixtures = await provider.fetchFixtures(from, to);
  log.info({ count: fixtures.length, provider: provider.name, from, to }, 'fixtures pulled');

  for (const f of fixtures) {
    await db
      .insert(matches)
      .values({
        id: f.id,
        provider: f.provider,
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam,
        kickoffAt: f.kickoffAt,
        status: f.status,
        homeScore: f.homeScore ?? 0,
        awayScore: f.awayScore ?? 0,
        minute: f.minute ?? null,
        raw: f.raw ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: matches.id,
        set: {
          status: f.status,
          homeScore: f.homeScore ?? 0,
          awayScore: f.awayScore ?? 0,
          minute: f.minute ?? null,
          raw: f.raw ?? null,
          updatedAt: new Date(),
        },
      });
  }
  return fixtures.length;
}

export async function ensureMatchRow(
  db: Db['db'],
  matchId: string,
  home = 'Home',
  away = 'Away',
): Promise<void> {
  const existing = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (existing.length) return;
  await db.insert(matches).values({
    id: matchId,
    provider: 'manual',
    homeTeam: home,
    awayTeam: away,
    status: 'live',
  });
}
