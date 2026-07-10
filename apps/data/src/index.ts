/**
 * Kickoff data service — fixtures, live poll, Redis bus, REPLAY_MODE.
 * Health: GET :4001/health
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createDb, migrate } from './db/client.js';
import { createRedis } from './redis/bus.js';
import { createApiFootballProvider } from './providers/apiFootball.js';
import { createFootballDataProvider } from './providers/footballData.js';
import { createFailoverProvider } from './providers/failover.js';
import { pullAndStoreFixtures } from './ingest/fixtures.js';
import { startLivePoller } from './ingest/livePoller.js';
import { runReplay } from './ingest/replay.js';

const log = pino({ name: 'data' });
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const cfg = loadConfig();
  const { db, pool } = createDb(cfg.DATABASE_URL);
  await migrate(pool);
  log.info('postgres migrated');

  const redis = createRedis(cfg.REDIS_URL);
  await redis.connect();
  log.info({ url: cfg.REDIS_URL }, 'redis connected');

  const primary = cfg.API_FOOTBALL_KEY
    ? createApiFootballProvider(cfg.API_FOOTBALL_KEY, cfg.API_FOOTBALL_BASE)
    : null;
  const fallback = cfg.FOOTBALL_DATA_KEY
    ? createFootballDataProvider(cfg.FOOTBALL_DATA_KEY, cfg.FOOTBALL_DATA_BASE)
    : null;

  let providerName = 'none';
  let stopLive: (() => void) | undefined;
  let stopReplay: (() => void) | undefined;

  const health = {
    ok: true,
    service: 'kickoff-data',
    replayMode: !!cfg.REPLAY_MODE,
    provider: providerName,
    liveMatchIds: cfg.liveMatchIds,
    fixturesLoaded: 0,
    redis: true,
    postgres: true,
    startedAt: new Date().toISOString(),
  };

  if (cfg.REPLAY_MODE) {
    const defaultReplay = resolve(
      __dirname,
      '../data/replays/euros-2024-final.json',
    );
    const file = cfg.REPLAY_FILE || defaultReplay;
    health.provider = 'replay';
    providerName = 'replay';
    const replay = await runReplay({
      filePath: file,
      redis,
      db,
      speed: cfg.REPLAY_SPEED,
      log,
      loop: process.env.REPLAY_LOOP === '1',
    });
    stopReplay = replay.stop;
    // Register replay match for bookmaker subscribers
    if (!cfg.liveMatchIds.length) {
      cfg.liveMatchIds.push('replay-euros-2024-final');
    }
  } else {
    try {
      const provider = createFailoverProvider(primary, fallback, log);
      providerName = provider.name;
      health.provider = provider.name;

      if (!cfg.SKIP_FIXTURE_PULL && (primary || fallback)) {
        health.fixturesLoaded = await pullAndStoreFixtures(
          db,
          provider,
          cfg.FIXTURE_FROM,
          cfg.FIXTURE_TO,
          log,
        );
      } else if (!primary && !fallback) {
        log.warn(
          'No API keys and REPLAY_MODE off — set REPLAY_MODE=1 or API_FOOTBALL_KEY / FOOTBALL_DATA_KEY',
        );
      }

      if (cfg.liveMatchIds.length && (primary || fallback)) {
        const live = startLivePoller({
          matchIds: cfg.liveMatchIds,
          provider,
          redis,
          db,
          intervalMs: cfg.POLL_INTERVAL_MS,
          log,
        });
        stopLive = live.stop;
      }
    } catch (e) {
      log.error(e, 'provider bootstrap failed');
      health.ok = false;
    }
  }

  const server = http.createServer(async (req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
      let redisOk = true;
      try {
        const pong = await redis.ping();
        redisOk = pong === 'PONG';
      } catch {
        redisOk = false;
      }
      let pgOk = true;
      try {
        await pool.query('SELECT 1');
      } catch {
        pgOk = false;
      }
      const body = {
        ...health,
        provider: providerName,
        redis: redisOk,
        postgres: pgOk,
        ok: health.ok && redisOk && pgOk,
      };
      res.writeHead(body.ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
      return;
    }

    if (req.url === '/matches' && req.method === 'GET') {
      const { rows } = await pool.query(
        'SELECT id, home_team, away_team, status, kickoff_at FROM matches ORDER BY kickoff_at NULLS LAST LIMIT 100',
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ matches: rows }));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  server.listen(cfg.DATA_PORT, () => {
    log.info(
      {
        port: cfg.DATA_PORT,
        replayMode: cfg.REPLAY_MODE,
        provider: providerName,
        liveMatchIds: cfg.liveMatchIds,
      },
      'data service listening',
    );
  });

  const shutdown = async () => {
    log.info('shutting down');
    stopLive?.();
    stopReplay?.();
    server.close();
    await redis.quit().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  log.error(err, 'data service failed');
  process.exit(1);
});
