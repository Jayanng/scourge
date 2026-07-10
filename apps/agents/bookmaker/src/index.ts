/**
 * Bookmaker agent — Redis match.*.event → deterministic templates → create_market.
 * Hot path: NO LLM. Optional Groq only polishes question text after selection.
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pino from 'pino';
import { Redis } from 'ioredis';
import { createInjClient } from '@kickoff/inj-client';
import {
  applyEvent,
  emptyMatchState,
  evaluateTemplates,
  type MatchEvent,
  type MatchState,
} from './templates.js';
import { createPool, ensureTables, insertAgentAction, insertMarket } from './db.js';
import { maybePolishQuestion } from './groq.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../../.env') });

const log = pino({ name: 'agent-bookmaker' });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://kickoff:kickoff@localhost:5432/kickoff';
const DRY_RUN = process.env.BOOKMAKER_DRY_RUN === '1';
const USE_GROQ = process.env.BOOKMAKER_USE_GROQ === '1';
const GROQ_API_KEY = process.env.GROQ_API_KEY ?? '';
const MOCK_CHAIN = process.env.BOOKMAKER_MOCK_CHAIN === '1' || DRY_RUN;

async function main() {
  const pool = createPool(DATABASE_URL);
  await ensureTables(pool);

  const redis = new Redis(REDIS_URL);
  const sub = redis.duplicate();

  // Chain client only if not mock/dry
  const client = MOCK_CHAIN
    ? null
    : (() => {
        try {
          return createInjClient();
        } catch (e) {
          log.warn({ err: String(e) }, 'inj-client unavailable — mock chain mode');
          return null;
        }
      })();

  if (client) {
    await client.assertFactoryUsdcHealthy();
    log.info(
      { factory: client.config.marketFactoryAddress, sender: client.sender },
      'bookmaker chain ready',
    );
  } else {
    log.info('BOOKMAKER_MOCK_CHAIN / dry-run — will not broadcast txs');
  }

  const matchState = new Map<string, MatchState>();
  const spawnedKeys = new Map<string, Set<string>>();

  await sub.psubscribe('match.*.event');
  log.info({ channel: 'match.*.event' }, 'bookmaker subscribed');

  // Publish ready action
  await publishAction(redis, pool, {
    action: 'ready',
    payload: {
      templates: [
        'match_winner',
        'next_goal_within',
        'corner_between_minutes',
        'player_sot_over',
        'first_yellow_before',
      ],
      dryRun: MOCK_CHAIN,
      groq: USE_GROQ && !!GROQ_API_KEY,
    },
  });

  sub.on('pmessage', (_pattern, channel, message) => {
    void handleMessage(channel, message).catch((e) =>
      log.error({ err: String(e) }, 'handle message failed'),
    );
  });

  async function handleMessage(channel: string, message: string) {
    // channel: match.{matchId}.event
    const parts = channel.split('.');
    const matchId = parts[1] ?? 'unknown';

    let event: MatchEvent;
    try {
      event = JSON.parse(message) as MatchEvent;
    } catch {
      log.warn({ channel, message }, 'invalid event json');
      return;
    }

    if (!matchState.has(matchId)) matchState.set(matchId, emptyMatchState());
    if (!spawnedKeys.has(matchId)) spawnedKeys.set(matchId, new Set());

    const prev = matchState.get(matchId)!;
    const next = applyEvent(prev, event);
    matchState.set(matchId, next);

    const candidates = evaluateTemplates({
      matchId,
      event,
      spawnedKeys: spawnedKeys.get(matchId)!,
      state: prev,
      nowSec: Math.floor(Date.now() / 1000),
    });

    if (!candidates.length) return;

    for (const c of candidates) {
      spawnedKeys.get(matchId)!.add(c.key);

      let question = c.question;
      // Optional Groq polish AFTER deterministic selection
      question = await maybePolishQuestion(question, {
        enabled: USE_GROQ,
        apiKey: GROQ_API_KEY,
      });

      let contractAddress: string | undefined;
      let txHash: string | undefined;

      if (client && !MOCK_CHAIN) {
        try {
          const res = await client.createMarket(question, c.closesAt, {
            matchId,
            template: c.template,
          });
          contractAddress = res.address;
          txHash = res.txHash;
        } catch (e) {
          log.error({ err: String(e), template: c.template }, 'create_market failed');
          await publishAction(redis, pool, {
            action: 'create_market_error',
            matchId,
            payload: { template: c.template, error: String(e) },
          });
          continue;
        }
      } else {
        contractAddress = `mock_${c.key.replace(/[^a-z0-9]/gi, '_').slice(0, 40)}`;
        txHash = 'mock';
      }

      const dbId = await insertMarket(pool, {
        contractAddress,
        matchId,
        template: c.template,
        question,
        closesAt: c.closesAt,
        meta: { ...c.meta, key: c.key, txHash, event },
      });

      await publishAction(redis, pool, {
        action: 'market_created',
        matchId,
        marketId: contractAddress,
        payload: {
          dbId,
          template: c.template,
          question,
          closesAt: c.closesAt,
          contractAddress,
          txHash,
          trigger: event,
        },
      });

      log.info(
        { matchId, template: c.template, contractAddress, question },
        'market spawned',
      );
    }
  }

  if (process.env.AGENT_SCAFFOLD_EXIT === '1') {
    process.exit(0);
  }

  process.on('SIGINT', async () => {
    await sub.quit();
    await redis.quit();
    await pool.end();
    process.exit(0);
  });
}

async function publishAction(
  redis: Redis,
  pool: import('pg').Pool,
  opts: {
    action: string;
    matchId?: string;
    marketId?: string;
    payload?: Record<string, unknown>;
  },
) {
  const msg = {
    agent: 'bookmaker',
    action: opts.action,
    matchId: opts.matchId,
    marketId: opts.marketId,
    payload: opts.payload,
    ts: Date.now(),
  };
  await redis.publish('agent.bookmaker.action', JSON.stringify(msg));
  await insertAgentAction(pool, {
    action: opts.action,
    matchId: opts.matchId,
    marketId: opts.marketId,
    payload: opts.payload,
  }).catch((e) => log.warn({ err: String(e) }, 'agent_actions insert failed'));
}

main().catch((err) => {
  log.error(err, 'bookmaker failed');
  process.exit(1);
});
