/**
 * Trader agent skeleton — PERSONA=ronaldo9|var — Prompt 8.
 */
import 'dotenv/config';
import pino from 'pino';

const log = pino({ name: 'agent-trader' });
const persona = process.env.PERSONA ?? 'ronaldo9';

async function main() {
  log.info(
    {
      persona,
      style: persona === 'var' ? 'conservative' : 'aggressive',
      signals: 'GET /signals (x402) — not yet mounted',
    },
    'trader scaffold — not yet betting',
  );
  if (process.env.AGENT_SCAFFOLD_EXIT === '1') process.exit(0);
  process.stdin.resume();
}

main().catch((err) => {
  log.error(err, 'trader failed');
  process.exit(1);
});
