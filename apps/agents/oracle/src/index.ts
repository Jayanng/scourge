/**
 * Oracle agent (Prompt 6) — spawn ×3 via INSTANCE=1|2|3.
 *
 * Pipeline (NO LLM):
 *   1. Learn about markets from the Bookmaker's `agent.bookmaker.action` stream.
 *   2. Accumulate a pure match view from `match.*.event`.
 *   3. Deterministically resolve each market (observe.ts) — on new events and
 *      on a periodic tick so time-based markets settle at `closes_at`.
 *   4. Sign the observation (sign.ts) and POST it to the Resolver via x402
 *      (submit.ts). Also publish `agent.oracle.action` + persist for the UI.
 *
 * FAULT_INJECT lets a single instance misbehave to exercise 2-of-3 consensus:
 *   wrong   → flip yes<->no
 *   void    → always report void
 *   offline → never submit
 *   lag     → delay every submission by ORACLE_FAULT_LAG_MS
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
export { verifyObservation } from './sign.js';
import pino from 'pino';
import { Redis } from 'ioredis';
import { createX402Client } from '@kickoff/x402-client';
import type { OracleObservation, Outcome, TrackedMarket } from '@kickoff/shared-types';
import {
  applyEvent,
  emptyMatchObs,
  resolveMarket,
  type MatchEvent,
  type MatchObs,
} from './observe.js';
import { signObservation } from './sign.js';
import { submitObservation } from './submit.js';
import { createPool, ensureAgentActionsTable as ensureTables, insertAgentAction } from '@kickoff/agent-db';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../../.env') });

const INSTANCE = Number(process.env.INSTANCE ?? 1);
const ORACLE_ID = `oracle-${INSTANCE}`;
const log = pino({ name: `agent-oracle`, base: { instance: INSTANCE } });

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://kickoff:kickoff@localhost:5432/kickoff';
const RESOLVER_URL = process.env.RESOLVER_URL ?? 'http://localhost:4002';
const ORACLE_REWARD_PORT = Number(process.env.ORACLE_REWARD_PORT ?? 4101 + INSTANCE);
const ORACLE_SECRET = process.env.ORACLE_SHARED_SECRET ?? 'kickoff-oracle-secret';
const TICK_MS = Number(process.env.ORACLE_TICK_MS ?? 1000);
const FAULT = (process.env.FAULT_INJECT ?? '').trim().toLowerCase();
const FAULT_LAG_MS = Number(process.env.ORACLE_FAULT_LAG_MS ?? 3000);
const NO_DB = process.env.ORACLE_NO_DB === '1';

const x402 = createX402Client({
  mode: process.env.X402_MODE === 'live' ? 'live' : 'mock',
  facilitatorUrl: process.env.X402_FACILITATOR_URL,
  payTo: process.env.X402_PAY_TO,
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Apply this instance's configured fault to a resolved outcome. */
function corrupt(outcome: Outcome): Outcome {
  if (FAULT === 'wrong') return outcome === 'yes' ? 'no' : outcome === 'no' ? 'yes' : outcome;
  if (FAULT === 'void') return 'void';
  return outcome;
}

async function main() {
  const pool = NO_DB ? null : createPool(DATABASE_URL);
  if (pool) {
    try {
      await ensureTables(pool);
    } catch (e) {
      log.warn({ err: String(e) }, 'db unavailable — continuing without persistence');
    }
  }

  const redis = new Redis(REDIS_URL);
  const sub = redis.duplicate();

  const obsByMatch = new Map<string, MatchObs>();
  const markets = new Map<string, TrackedMarket>();
  const marketsByMatch = new Map<string, Set<string>>();
  const submitted = new Set<string>();

  await sub.psubscribe('match.*.event');
  await sub.subscribe('agent.bookmaker.action');
  log.info(
    {
      oracle: ORACLE_ID,
      resolver: RESOLVER_URL,
      x402: x402.mode,
      fault: FAULT || 'none',
      staggerSec: INSTANCE * 5,
    },
    'oracle online — observing markets',
  );

  sub.on('pmessage', (_pattern, channel, message) => {
    const matchId = channel.split('.')[1] ?? 'unknown';
    let event: MatchEvent;
    try {
      event = JSON.parse(message) as MatchEvent;
    } catch {
      log.warn({ channel }, 'invalid match event json');
      return;
    }
    const obs = obsByMatch.get(matchId) ?? emptyMatchObs();
    applyEvent(obs, event);
    obsByMatch.set(matchId, obs);
    void evaluateMatch(matchId).catch((e) =>
      log.error({ err: String(e) }, 'evaluate on event failed'),
    );
  });

  sub.on('message', (channel, message) => {
    if (channel !== 'agent.bookmaker.action') return;
    try {
      const msg = JSON.parse(message) as {
        action: string;
        matchId?: string;
        marketId?: string;
        payload?: Record<string, unknown>;
      };
      if (msg.action !== 'market_created') return;
      registerMarket(msg);
    } catch {
      log.warn('invalid bookmaker action json');
    }
  });

  function registerMarket(msg: {
    matchId?: string;
    marketId?: string;
    payload?: Record<string, unknown>;
  }) {
    const p = msg.payload ?? {};
    const market = (msg.marketId ?? p.contractAddress) as string | undefined;
    const matchId = msg.matchId;
    if (!market || !matchId) return;
    if (markets.has(market)) return;

    const tracked: TrackedMarket = {
      market,
      match_id: matchId,
      template: String(p.template ?? 'unknown').toLowerCase(),
      question: String(p.question ?? ''),
      closes_at: Number(p.closesAt ?? 0),
      meta: (p.meta as Record<string, unknown>) ?? {},
    };
    markets.set(market, tracked);
    if (!marketsByMatch.has(matchId)) marketsByMatch.set(matchId, new Set());
    marketsByMatch.get(matchId)!.add(market);
    log.info({ market, template: tracked.template }, 'tracking market');

    void evaluateMatch(matchId).catch((e) =>
      log.error({ err: String(e) }, 'evaluate on register failed'),
    );
  }

  async function evaluateMatch(matchId: string) {
    const obs = obsByMatch.get(matchId);
    const ids = marketsByMatch.get(matchId);
    if (!obs || !ids) return;
    const nowSec = Math.floor(Date.now() / 1000);
    for (const market of ids) {
      if (submitted.has(market)) continue;
      const tracked = markets.get(market)!;
      const res = resolveMarket(tracked, obs, nowSec);
      if (res.decided && res.outcome) {
        submitted.add(market);
        await emit(tracked, res.outcome, res.reason);
      }
    }
  }

  async function emit(tracked: TrackedMarket, truth: Outcome, reason: string) {
    const outcome = corrupt(truth);

    if (FAULT === 'offline') {
      log.warn({ market: tracked.market }, 'FAULT offline — suppressing observation');
      await record(tracked, outcome, reason, { delivered: false, suppressed: true });
      return;
    }
    if (FAULT === 'lag') await sleep(FAULT_LAG_MS);

    const observed_at = Date.now();
    const base = {
      market: tracked.market,
      match_id: tracked.match_id,
      template: tracked.template,
      outcome,
      evidence_url: `evidence://${tracked.match_id}/${tracked.template}/${tracked.market}`,
      observed_at,
      oracle: ORACLE_ID,
      instance: INSTANCE,
    };
    const observation: OracleObservation = {
      ...base,
      signature: signObservation(base, ORACLE_SECRET),
    };

    const result = await submitObservation(x402, RESOLVER_URL, observation);
    log.info(
      {
        market: tracked.market,
        template: tracked.template,
        truth,
        reported: outcome,
        reason,
        delivered: result.delivered,
        pay: result.payment.mode,
      },
      result.delivered ? 'observation delivered' : 'observation not delivered (resolver offline?)',
    );

    await redis.publish(
      'agent.oracle.action',
      JSON.stringify({
        agent: ORACLE_ID,
        action: 'observation',
        matchId: tracked.match_id,
        marketId: tracked.market,
        payload: { ...observation, reason, delivered: result.delivered },
        ts: observed_at,
      }),
    );
    await record(tracked, outcome, reason, {
      delivered: result.delivered,
      status: result.status,
      truth,
    });
  }

  async function record(
    tracked: TrackedMarket,
    outcome: Outcome,
    reason: string,
    extra: Record<string, unknown>,
  ) {
    if (!pool) return;
    await insertAgentAction(pool, {
      agent: ORACLE_ID,
      action: 'observation',
      matchId: tracked.match_id,
      marketId: tracked.market,
      payload: { outcome, reason, template: tracked.template, ...extra },
    }).catch((e) => log.warn({ err: String(e) }, 'agent_actions insert failed'));
  }

  const timer = setInterval(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const [matchId, ids] of marketsByMatch) {
      const obs = obsByMatch.get(matchId);
      if (!obs) continue;
      for (const market of ids) {
        if (submitted.has(market)) continue;
        const tracked = markets.get(market)!;
        const res = resolveMarket(tracked, obs, nowSec);
        if (res.decided && res.outcome) {
          submitted.add(market);
          void emit(tracked, res.outcome, res.reason).catch((e) =>
            log.error({ err: String(e) }, 'tick emit failed'),
          );
        }
      }
    }
  }, TICK_MS);

  if (process.env.AGENT_SCAFFOLD_EXIT === '1') {
    clearInterval(timer);
    await sub.quit();
    await redis.quit();
    if (pool) await pool.end();
    process.exit(0);
  }

  // x402 reward sink: the Resolver POSTs here after paying an accurate oracle.
  const rewardServer = createServer((req, res) => {
    if (req.method === 'POST' && (req.url ?? '').startsWith('/reward')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          const r = JSON.parse(body) as { outcome?: string; market?: string };
          log.info({ outcome: r.outcome, market: r.market }, 'reward received (x402 paid)');
        } catch {
          /* ignore */
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, oracle: ORACLE_ID }));
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, agent: ORACLE_ID }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });
  rewardServer.listen(ORACLE_REWARD_PORT, () => {
    log.info({ port: ORACLE_REWARD_PORT }, 'oracle reward endpoint listening (x402 sink)');
  });

  if (process.env.AGENT_SCAFFOLD_EXIT === '1') {
    clearInterval(timer);
    rewardServer.close();
    await sub.quit();
    await redis.quit();
    if (pool) await pool.end();
    process.exit(0);
  }

  process.on('SIGINT', async () => {
    clearInterval(timer);
    rewardServer.close();
    await sub.quit();
    await redis.quit();
    if (pool) await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error(err, 'oracle failed');
  process.exit(1);
});
