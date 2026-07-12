/**
 * Resolver agent (Prompt 7) — x402 hub + 2-of-3 consensus.
 *
 *   Oracle×3 ──POST /observe (signed, paid via x402)──▶ here
 *      ▼
 *   verify signatures → 2-of-3 consensus → settle market on-chain (inj-client)
 *      ▼
 *   reward accurate oracles via x402 (pay accurate reporters)
 *
 * The market contract only allows its configured `resolver` address to call
 * Settle, so this agent signs with the deployer key (same holder the Bookmaker
 * uses to create markets). In mock mode (no key) it still runs consensus and
 * rewards oracles, just without broadcasting a real settlement tx.
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import pino from 'pino';
import { Redis } from 'ioredis';
import { createX402Client } from '@kickoff/x402-client';
import { verifyX402Payment, setX402ResponseHeader } from '@kickoff/x402-client/middleware';
import { createInjClient, type InjClient } from '@kickoff/inj-client';
import type { OracleObservation } from '@kickoff/shared-types';
import { Consensus } from './consensus.js';
import { createPool, ensureAgentActionsTable as ensureTables, insertAgentAction } from '@kickoff/agent-db';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../../.env') });

const log = pino({ name: 'agent-resolver' });

const PORT = Number(process.env.RESOLVER_PORT ?? 4002);
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://kickoff:kickoff@localhost:5432/kickoff';
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const ORACLE_SECRET = process.env.ORACLE_SHARED_SECRET ?? 'kickoff-oracle-secret';
const REWARD_USDC = process.env.RESOLVER_REWARD_AMOUNT ?? '1000'; // 0.001 USDC (6dp)
const ORACLE_REWARD_PORT_BASE = Number(process.env.ORACLE_REWARD_PORT_BASE ?? 4101);
const NO_DB = process.env.RESOLVER_NO_DB === '1';
const MOCK_CHAIN = process.env.RESOLVER_MOCK_CHAIN === '1';

const X402_MODE = process.env.X402_MODE === 'live' ? 'live' : 'mock';
const x402 = createX402Client({
  mode: X402_MODE,
  facilitatorUrl: process.env.X402_FACILITATOR_URL,
  payTo: process.env.X402_PAY_TO,
  privateKey: X402_MODE === 'live' ? process.env.X402_PRIVATE_KEY : undefined,
  network: process.env.X402_NETWORK ?? 'base-sepolia',
});

const consensus = new Consensus(ORACLE_SECRET);

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

  const client: InjClient | null = MOCK_CHAIN
    ? null
    : (() => {
        try {
          return createInjClient();
        } catch (e) {
          log.warn({ err: String(e) }, 'inj-client unavailable — mock settle mode');
          return null;
        }
      })();

  if (client) {
    try {
      await client.assertFactoryUsdcHealthy();
    } catch {
      /* non-fatal for settle */
    }
    log.info('resolver chain ready — can settle markets');
  } else {
    log.info('RESOLVER_MOCK_CHAIN — will not broadcast settle txs');
  }

  async function trySettle(market: string): Promise<void> {
    const bundle = consensus.get(market);
    if (!bundle || bundle.settled) return;
    const { consensus: consensusOutcome, verified, breakdown } = consensus.evaluate(market);

    if (consensusOutcome == null) {
      log.info(
        { market, verified, breakdown },
        'consensus not yet reached (need 2-of-3)',
      );
      return;
    }

    const winners = bundle.observations
      .filter((o) => o.outcome === consensusOutcome)
      .map((o) => o.instance);

    consensus.markSettled(market, consensusOutcome, winners);

    let txHash: string | undefined;
    if (client) {
      try {
        const res = await client.settleMarket(market, consensusOutcome);
        txHash = res.txHash;
        } catch (e) {
          log.error({ err: String(e), market }, 'settleMarket failed — reopening for consensus');
          bundle.settled = false;
          bundle.consensus = null;
          bundle.winners = [];
          bundle.settledAt = null;
          return;
        }
    }

    log.info(
      { market, template: bundle.template, outcome: consensusOutcome, winners, txHash },
      'market settled via 2-of-3 consensus',
    );

    // Reward accurate oracles via x402 (agent-to-agent USDC economy).
    for (const o of bundle.observations) {
      if (o.outcome !== consensusOutcome) continue;
      const rewardUrl = `http://localhost:${ORACLE_REWARD_PORT_BASE + o.instance}/reward`;
      const payment = await x402.pay(rewardUrl, REWARD_USDC);
      log.info(
        { oracle: o.oracle, outcome: o.outcome, pay: payment.mode, rewardUrl },
        'rewarded accurate oracle via x402',
      );
    }

    await redis.publish(
      'agent.resolver.action',
      JSON.stringify({
        agent: 'resolver',
        action: 'settle',
        matchId: bundle.matchId,
        marketId: market,
        payload: { outcome: consensusOutcome, winners, breakdown, txHash, verified },
        ts: Date.now(),
      }),
    );
    await record(bundle, consensusOutcome, winners, txHash);
  }

  async function record(
    bundle: { market: string; matchId: string; template: string },
    outcome: string,
    winners: number[],
    txHash?: string,
  ) {
    if (!pool) return;
    await insertAgentAction(pool, {
      agent: 'resolver',
      action: 'settle',
      matchId: bundle.matchId,
      marketId: bundle.market,
      payload: { template: bundle.template, outcome, winners, txHash },
    }).catch((e) => log.warn({ err: String(e) }, 'agent_actions insert failed'));
  }

  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, agent: 'resolver', settled: consensus.all().filter((b) => b.settled).length }));
      return;
    }

    if (req.method === 'POST' && (req.url ?? '').startsWith('/observe')) {
      void (async () => {
        // Verify x402 payment in live mode
        if (X402_MODE === 'live') {
          const ok = await verifyX402Payment(req, res, {
            payTo: process.env.X402_PAY_TO ?? '',
            network: process.env.X402_NETWORK ?? 'base-sepolia',
            price: '$0.001',
            description: 'Submit oracle observation',
          });
          if (!ok) return;
        }

        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          let o: OracleObservation;
          try {
            o = JSON.parse(body) as OracleObservation;
          } catch {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'invalid json' }));
            return;
          }
          const ingested = consensus.ingest(o);
          if (!ingested) {
            res.writeHead(401, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'bad signature' }));
            return;
          }
          const { consensus: c, verified, breakdown } = consensus.evaluate(o.market);
          await trySettle(o.market).catch((e) =>
            log.error({ err: String(e) }, 'settle failed'),
          );
          if (X402_MODE === 'live') setX402ResponseHeader(res);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              market: o.market,
              verified,
              breakdown,
              consensus: c,
              settled: consensus.get(o.market)?.settled ?? false,
            }),
          );
        });
      })();
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  server.listen(PORT, () => {
    log.info({ port: PORT }, 'resolver listening — /observe (x402) + /health');
  });

  if (process.env.AGENT_SCAFFOLD_EXIT === '1') {
    server.close();
    await redis.quit();
    if (pool) await pool.end();
    process.exit(0);
  }

  process.on('SIGINT', async () => {
    server.close();
    await redis.quit();
    if (pool) await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  log.error(err, 'resolver failed');
  process.exit(1);
});
