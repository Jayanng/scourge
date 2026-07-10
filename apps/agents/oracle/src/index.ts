/**
 * Oracle agent skeleton (spawn ×3 via INSTANCE=1|2|3).
 * Signs observations, posts to Resolver with x402 — Prompt 6.
 */
import 'dotenv/config';
import pino from 'pino';

const log = pino({ name: 'agent-oracle' });
const instance = Number(process.env.INSTANCE ?? 1);

async function main() {
  log.info(
    {
      instance,
      staggerSec: instance * 5,
      faultInject: process.env.FAULT_INJECT || null,
    },
    'oracle scaffold — not yet observing markets',
  );
  if (process.env.AGENT_SCAFFOLD_EXIT === '1') process.exit(0);
  process.stdin.resume();
}

main().catch((err) => {
  log.error(err, 'oracle failed');
  process.exit(1);
});
