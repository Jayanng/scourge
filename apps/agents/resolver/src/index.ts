/**
 * Resolver agent skeleton — x402 hub + 2-of-3 consensus — Prompt 7.
 */
import 'dotenv/config';
import pino from 'pino';

const log = pino({ name: 'agent-resolver' });

async function main() {
  log.info(
    {
      x402Mode: process.env.X402_MODE ?? 'mock',
      consensus: '2-of-3',
      windowSec: 30,
    },
    'resolver scaffold — /observe not yet mounted',
  );
  if (process.env.AGENT_SCAFFOLD_EXIT === '1') process.exit(0);
  process.stdin.resume();
}

main().catch((err) => {
  log.error(err, 'resolver failed');
  process.exit(1);
});
