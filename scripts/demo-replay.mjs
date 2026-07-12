/**
 * Prompt 10 — one-shot demo orchestrator.
 *
 * Boots the entire Kickoff swarm against the REPLAY_MODE match feed (no API
 * keys, no real chain) so a judge can watch the full lifecycle in one command:
 *
 *   data(replay) → bookmaker → oracle×3 → resolver → trader×2
 *
 * Everything runs in MOCK_CHAIN mode (no deployer key needed); agents still
 * create markets, reach 2-of-3 oracle consensus, settle, and bet — the on-chain
 * broadcasts are skipped. Press Ctrl+C (or wait for --duration) to tear down.
 *
 * Requires Redis + Postgres (docker compose -f infra/docker-compose.yml up -d).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---- config ---------------------------------------------------------------
const PROD = process.env.NODE_ENV === 'production';

/** Resolve the tsx launcher robustly (pnpm's .bin symlink can be missing on Windows). */
function tsxSpawnArgs(cwd) {
  if (PROD) return { command: 'node', args: [resolve(cwd, 'dist/index.js')] };
  try {
    const cli = require.resolve('tsx/cli');
    return { command: process.execPath, args: [cli, resolve(cwd, 'src/index.ts')] };
  } catch {
    // Fallback: rely on a tsx on PATH (pnpm exec / global).
    return { command: 'tsx', args: [resolve(cwd, 'src/index.ts')] };
  }
}

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://kickoff:kickoff@localhost:5432/kickoff';
const DURATION_MS = Number(process.env.DEMO_DURATION_MS ?? 45000);
const DATA_PORT = Number(process.env.DATA_PORT ?? 4001);

// Load monorepo root .env so DATABASE_URL/REDIS_URL/secret propagate.
function loadEnv() {
  try {
    const raw = readFileSync(resolve(ROOT, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* no .env — fine, we have defaults */
  }
}
loadEnv();

const baseEnv = {
  ...process.env,
  REDIS_URL,
  DATABASE_URL,
  REPLAY_MODE: '1',
  ORACLE_SHARED_SECRET: process.env.ORACLE_SHARED_SECRET ?? 'kickoff-oracle-secret',
  X402_MODE: 'mock',
};

// ---- process table --------------------------------------------------------
const procs = [];
const spawned = new Set();

function start(name, cwd, env, extraArgs = []) {
  const r = tsxSpawnArgs(cwd);
  const child = spawn(r.command, [...r.args, ...extraArgs], {
    cwd,
    env: { ...baseEnv, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => prefix(name, d, false));
  child.stderr.on('data', (d) => prefix(name, d, true));
  child.on('exit', (code) => {
    if (spawned.has(name)) log(`[${name}] exited (${code})`);
  });
  procs.push({ name, child });
  spawned.add(name);
  return child;
}

function prefix(name, buf, isErr) {
  const tag = isErr ? 'ERR ' : '    ';
  for (const line of buf.toString().split('\n')) {
    if (line.trim()) process.stdout.write(`${tag}[${name}] ${line}\n`);
  }
}
function log(s) {
  process.stdout.write(`>>> ${s}\n`);
}

// ---- swarm definition -----------------------------------------------------
function bootSwarm() {
  const agents = resolve(ROOT, 'apps/agents');
  const dataCwd = resolve(ROOT, 'apps/data');

  start('data', dataCwd, { REPLAY_FILE: resolve(dataCwd, 'data/replays/euros-2024-final.json') });

  start('bookmaker', resolve(agents, 'bookmaker'), {
    BOOKMAKER_MOCK_CHAIN: '1',
    BOOKMAKER_DRY_RUN: '1',
  });

  for (const inst of [1, 2, 3]) {
    const fault = inst === 3 ? 'wrong' : ''; // 1 oracle dissents to prove 2-of-3
    start(`oracle-${inst}`, resolve(agents, 'oracle'), {
      INSTANCE: String(inst),
      FAULT_INJECT: fault,
    });
  }

  start('resolver', resolve(agents, 'resolver'), { RESOLVER_MOCK_CHAIN: '1' });

  start('trader-ronaldo9', resolve(agents, 'trader'), {
    PERSONA: 'ronaldo9',
    TRADER_MOCK_CHAIN: '1',
    TRADER_PORT: '4004',
  });
  start('trader-var', resolve(agents, 'trader'), {
    PERSONA: 'var',
    TRADER_MOCK_CHAIN: '1',
    TRADER_PORT: '4003',
  });
}

// ---- readiness + run ------------------------------------------------------
async function waitForData(timeoutMs = 20000) {
  const url = `http://localhost:${DATA_PORT}/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      const j = await res.json();
      if (j.ok) {
        log('data service healthy — replay feed live');
        return true;
      }
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('data service did not become healthy in time');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function teardown(code = 0) {
  for (const { name, child } of procs) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => {
    for (const { child } of procs) {
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }
  }, 3000).unref();
  process.exit(code);
}

async function main() {
  log('Kickoff Protocol — demo replay orchestrator (mock chain, replay feed)');
  log(`Redis=${REDIS_URL}  Postgres=${DATABASE_URL}  duration=${DURATION_MS}ms`);
  bootSwarm();

  try {
    await waitForData();
  } catch (e) {
    log(`ERROR: ${e.message}`);
    log('Is Redis + Postgres up?  docker compose -f infra/docker-compose.yml up -d');
    teardown(1);
    return;
  }

  log('swarm spawned — watch the lifecycle: markets → observations → 2-of-3 consensus → settle → bets');
  log(`running for ${DURATION_MS / 1000}s, then tearing down. (Ctrl+C to stop early)`);

  await sleep(DURATION_MS);
  log('demo window complete — tearing down swarm');
  teardown(0);
}

process.on('SIGINT', () => {
  log('interrupted — tearing down');
  teardown(0);
});
process.on('SIGTERM', () => {
  log('terminated — tearing down');
  teardown(0);
});

main().catch((e) => {
  log(`fatal: ${e.stack ?? e}`);
  teardown(1);
});
