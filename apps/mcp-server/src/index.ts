/**
 * Injective MCP server — agents call tools by name; private key never leaves this process.
 *
 * Tools: create_market, place_bet, submit_observation, settle_market, claim
 *
 * Modes:
 *   MCP_TRANSPORT=stdio (default) — MCP over stdin/stdout
 *   MCP_TRANSPORT=smoke — run end-to-end smoke then exit
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import pino from 'pino';
import { createInjClient } from '@kickoff/inj-client';
import {
  handleClaim,
  handleCreateMarket,
  handlePlaceBet,
  handleSettleMarket,
  handleSubmitObservation,
} from './tools.js';

// Load monorepo root .env (never log secrets)
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../.env') });

// Always log to stderr so stdio MCP framing stays clean
const logger = pino(
  { name: 'mcp-server', level: process.env.LOG_LEVEL ?? 'info' },
  pino.destination(2),
);

function textResult(payload: unknown, isError = false) {
  return {
    isError,
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  };
}

async function buildServer() {
  const mockChain = process.env.MCP_MOCK_CHAIN === '1';
  let client: Awaited<ReturnType<typeof createInjClient>> | null = null;

  if (mockChain) {
    logger.warn('MCP_MOCK_CHAIN set — booting without a chain client (dry-run)');
  } else {
    try {
      client = createInjClient();
      await client.assertFactoryUsdcHealthy();
      logger.info(
        {
          sender: client.sender,
          factory: client.config.marketFactoryAddress,
          usdc: client.config.usdcCw20Address,
        },
        'factory USDC pointer healthy',
      );
    } catch (e) {
      logger.warn(
        { err: String(e) },
        'no deployer key — MCP server in dry-run mode (set MCP_MOCK_CHAIN=1 to silence)',
      );
      client = null;
    }
  }

  const server = new McpServer({
    name: 'kickoff-injective-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'create_market',
    {
      description: 'Spawn a new binary market via the factory contract.',
      inputSchema: {
        question: z.string(),
        closes_at: z.number().int(),
        match_id: z.string(),
        template: z.string(),
      },
    },
    async (args) => {
      if (!client) return textResult({ ok: true, dryRun: true, note: 'no chain client' }, true);
      try {
        const out = await handleCreateMarket(client, args);
        logger.info(out, 'create_market');
        return textResult(out);
      } catch (e) {
        logger.error(e, 'create_market failed');
        return textResult({ ok: false, error: String(e) }, true);
      }
    },
  );

  server.registerTool(
    'place_bet',
    {
      description: 'Place a Yes/No bet on a market using CW20 USDC Send.',
      inputSchema: {
        market: z.string(),
        side: z.enum(['yes', 'no']),
        amount: z.string(),
      },
    },
    async (args) => {
      if (!client) return textResult({ ok: true, dryRun: true, note: 'no chain client' }, true);
      try {
        const out = await handlePlaceBet(client, args);
        logger.info(out, 'place_bet');
        return textResult(out);
      } catch (e) {
        logger.error(e, 'place_bet failed');
        return textResult({ ok: false, error: String(e) }, true);
      }
    },
  );

  server.registerTool(
    'submit_observation',
    {
      description:
        'Oracle posts a signed outcome observation. Tracks 2-of-3 consensus window (off-chain).',
      inputSchema: {
        market: z.string(),
        outcome: z.enum(['yes', 'no', 'void']),
        evidence_url: z.string(),
        signature: z.string(),
      },
    },
    async (args) => {
      try {
        const out = await handleSubmitObservation(client, args);
        logger.info(out, 'submit_observation');
        return textResult(out);
      } catch (e) {
        logger.error(e, 'submit_observation failed');
        return textResult({ ok: false, error: String(e) }, true);
      }
    },
  );

  server.registerTool(
    'settle_market',
    {
      description: 'Resolver settles a market on-chain after 2-of-3 oracle consensus.',
      inputSchema: {
        market: z.string(),
        outcome: z.enum(['yes', 'no', 'void']),
      },
    },
    async (args) => {
      if (!client) return textResult({ ok: true, dryRun: true, note: 'no chain client' }, true);
      try {
        const out = await handleSettleMarket(client, args);
        logger.info(out, 'settle_market');
        return textResult(out);
      } catch (e) {
        logger.error(e, 'settle_market failed');
        return textResult({ ok: false, error: String(e) }, true);
      }
    },
  );

  server.registerTool(
    'claim',
    {
      description: 'Claim parimutuel payout (or void refund) from a settled market.',
      inputSchema: {
        market: z.string(),
      },
    },
    async (args) => {
      if (!client) return textResult({ ok: true, dryRun: true, note: 'no chain client' }, true);
      try {
        const out = await handleClaim(client, args);
        logger.info(out, 'claim');
        return textResult(out);
      } catch (e) {
        logger.error(e, 'claim failed');
        return textResult({ ok: false, error: String(e) }, true);
      }
    },
  );

  return { server, client };
}

async function runSmoke(client: Awaited<ReturnType<typeof buildServer>>['client']) {
  logger.info('MCP smoke: create_market → place_bet → submit_observation ×2 → settle → claim');

  const closesAt = Math.floor(Date.now() / 1000) + 3600;
  const created = await handleCreateMarket(client, {
    question: 'Smoke: first yellow before min 20?',
    closes_at: closesAt,
    match_id: 'smoke-1',
    template: 'first_yellow_before',
  });
  logger.info(created, 'created');

  if (!created.address) {
    throw new Error('create_market did not return market address — check factory Markets query');
  }
  const market = created.address as string;

  // Small bet (1 USDC = 1_000_000 base units with 6 decimals)
  const bet = await handlePlaceBet(client, {
    market,
    side: 'yes',
    amount: '1000000',
  });
  logger.info(bet, 'bet');

  await handleSubmitObservation(client, {
    market,
    outcome: 'yes',
    evidence_url: 'https://kickoff.markets/evidence/smoke-1',
    signature: 'oracle-1-sig',
  });
  const obs2 = await handleSubmitObservation(client, {
    market,
    outcome: 'yes',
    evidence_url: 'https://kickoff.markets/evidence/smoke-1b',
    signature: 'oracle-2-sig',
  });
  logger.info(obs2, 'obs consensus');

  const settled = await handleSettleMarket(client, { market, outcome: 'yes' });
  logger.info(settled, 'settled');

  const claimed = await handleClaim(client, { market });
  logger.info(claimed, 'claimed');

  logger.info({ market, created, bet, settled, claimed }, 'SMOKE OK');
}

async function main() {
  const mode = process.env.MCP_TRANSPORT ?? 'stdio';

  if (mode === 'smoke') {
    const client = createInjClient();
    await client.assertFactoryUsdcHealthy();
    await runSmoke(client);
    process.exit(0);
  }

  const { server } = await buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('MCP server listening on stdio');
}

main().catch((err) => {
  logger.error(err, 'mcp-server fatal');
  process.exit(1);
});
