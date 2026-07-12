/**
 * Trader agent (Prompt 8) — PERSONA=ronaldo9|var.
 *
 * Pipeline (NO LLM):
 *   1. Subscribe to `agent.bookmaker.action` (new markets) + `agent.resolver.action`
 *      (settled outcomes) over Redis. Maintains a small signal cache.
 *   2. Pay an x402 fee to "consume" the live signal feed (agent-to-agent economy).
 *   3. Decide a side + stake deterministically from the template + persona
 *      (strategy.ts). Aggressive fades oracle consensus; conservative follows it.
 *   4. Place the bet in USDC via inj-client (CW20 Send -> market Receive hook).
 *
 * Two instances run concurrently with different personas. In mock mode
 * (no deployer key) it still decides + emits actions without broadcasting a tx.
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
import { decideBet, isAggressive, type Persona } from './strategy.js';
import { createPool, ensureAgentActionsTable as ensureTables, insertAgentAction } from '@kickoff/agent-db';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../../.env') });

const PERSONA = (process.env.PERSONA === 'var' ? 'var' : 'ronaldo9') as Persona;
const TRADER_ID = `trader-${PERSONA}`;
const log = pino({ name: `agent-trader`, base: { persona: PERSONA } });

const PORT = Number(process.env.TRADER_PORT ?? (PERSONA === 'var' ? 4003 : 4004));
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://kickoff:kickoff@localhost:5432/kickoff';
const MOCK_CHAIN = process.env.TRADER_MOCK_CHAIN === '1';
const NO_DB = process.env.TRADER_NO_DB === '1';
const BET_AMOUNT = Number(process.env.TRADER_BET_AMOUNT ?? 0); // 0 = use persona default
const MAX_BETS = Number(process.env.TRADER_MAX_BETS ?? 0);
const SIGNAL_PROVIDER_URL = process.env.SIGNAL_PROVIDER_URL ?? 'http://localhost:4002/signals';

const X402_MODE = process.env.X402_MODE === 'live' ? 'live' : 'mock';
const x402 = createX402Client({
  mode: X402_MODE,
  facilitatorUrl: process.env.X402_FACILITATOR_URL,
  payTo: process.env.X402_PAY_TO,
  privateKey: X402_MODE === 'live' ? process.env.X402_PRIVATE_KEY : undefined,
  network: process.env.X402_NETWORK ?? 'base-sepolia',
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

  const client: InjClient | null = MOCK_CHAIN
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
    try {
      await client.assertFactoryUsdcHealthy();
      log.info('trader chain ready — will place USDC bets');
    } catch (e) {
      log.warn({ err: String(e) }, 'factory USDC check failed');
    }
  } else {
    log.info('TRADER_MOCK_CHAIN — will not broadcast bet txs');
  }

  // Signal cache: market -> latest oracle consensus outcome.
  const consensusByMarket = new Map<string, 'yes' | 'no' | 'void'>();

  const betsPlaced = new Map<string, number>(); // market -> count (1 bet per market/persona)
  let totalBets = 0;

  await redis.subscribe('agent.bookmaker.action', 'agent.resolver.action');
  log.info({ trader: TRADER_ID, persona: PERSONA, port: PORT }, 'trader online — watching markets');

  redis.on('message', (_channel, message) => {
    let msg: { action?: string; marketId?: string; payload?: Record<string, unknown> };
    try {
      msg = JSON.parse(message) as typeof msg;
    } catch {
      return;
    }
    if (msg.action === 'market_created') {
      void considerMarket(msg).catch((e) =>
        log.error({ err: String(e) }, 'consider market failed'),
      );
    } else if (msg.action === 'settle' && msg.marketId) {
      const o = msg.payload?.outcome as 'yes' | 'no' | 'void' | undefined;
      if (o) consensusByMarket.set(msg.marketId, o);
    }
  });

  async function considerMarket(msg: {
    marketId?: string;
    matchId?: string;
    payload?: Record<string, unknown>;
  }) {
    const market = (msg.marketId ?? msg.payload?.contractAddress) as string | undefined;
    const matchId = msg.matchId;
    if (!market || !matchId) return;
    if ((betsPlaced.get(market) ?? 0) >= 1) return; // one bet per market per persona
    if (MAX_BETS && totalBets >= MAX_BETS) return;

    const template = String(msg.payload?.template ?? 'unknown');
    const meta = (msg.payload?.meta as Record<string, unknown>) ?? {};
    const consensus = consensusByMarket.get(market);

    // Consume the signal feed via x402 (pays the external provider).
    const pay = await x402.pay(SIGNAL_PROVIDER_URL, '100');

    const decision = decideBet(PERSONA, { template, meta, consensus });
    const amount = BET_AMOUNT || decision.baseAmount;

    betsPlaced.set(market, 1);
    totalBets++;

    await sleep(decision.delayMs);

    let txHash: string | undefined;
    if (client) {
      try {
        const res = await client.placeBet(market, decision.side, String(amount));
        txHash = res.txHash;
      } catch (e) {
        log.error({ err: String(e), market }, 'placeBet failed');
        betsPlaced.set(market, 0);
        totalBets--;
        return;
      }
    }

    log.info(
      {
        market,
        template,
        side: decision.side,
        amount,
        consensus: consensus ?? null,
        persona: PERSONA,
        pay: pay.mode,
        txHash,
      },
      'bet placed',
    );

    await redis.publish(
      'agent.trader.action',
      JSON.stringify({
        agent: TRADER_ID,
        action: 'bet',
        matchId,
        marketId: market,
        payload: {
          side: decision.side,
          amount,
          template,
          consensus: consensus ?? null,
          confidence: decision.confidence,
          reason: decision.reason,
          txHash,
        },
        ts: Date.now(),
      }),
    );
    await record(market, matchId, decision.side, amount, decision.reason, txHash);
  }

  async function record(
    market: string,
    matchId: string,
    side: string,
    amount: number,
    reason: string,
    txHash?: string,
  ) {
    if (!pool) return;
    await insertAgentAction(pool, {
      agent: TRADER_ID,
      action: 'bet',
      matchId,
      marketId: market,
      payload: { side, amount, reason, txHash },
    }).catch((e) => log.warn({ err: String(e) }, 'agent_actions insert failed'));
  }

  const server = createServer((req, res) => {
    if (req.method === 'GET' && (req.url ?? '').startsWith('/signals')) {
      void (async () => {
        if (X402_MODE === 'live') {
          const ok = await verifyX402Payment(req, res, {
            payTo: process.env.X402_PAY_TO ?? '',
            network: process.env.X402_NETWORK ?? 'base-sepolia',
            price: '$0.10',
            description: 'Trader signal subscription',
          });
          if (!ok) return;
        }

        if (X402_MODE === 'live') setX402ResponseHeader(res);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            trader: TRADER_ID,
            persona: PERSONA,
            aggressive: isAggressive(PERSONA),
            consensus: [...consensusByMarket.entries()],
          }),
        );
      })();
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, agent: TRADER_ID, bets: totalBets }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
  });

  server.listen(PORT, () => {
    log.info({ port: PORT }, 'trader listening — /signals (x402) + /health');
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
  log.error(err, 'trader failed');
  process.exit(1);
});
