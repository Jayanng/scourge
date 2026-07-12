/**
 * CCTP Mint Script — completes the cross-chain bridge on Injective.
 *
 * After a burn on Base Sepolia is attested by Circle, this script
 * submits the attestation to the Injective CCTP contract to mint USDC.
 *
 * Usage:
 *   node scripts/cctp-mint.mjs <attestation> <recipient> <amount>
 *
 * Prerequisites:
 *   - DEPLOYER_PRIVATE_KEY set in .env
 *   - Injective CCTP contract deployed (or use mock CCTP)
 */

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '..', '.env') });

const [attestation, recipient, amount] = process.argv.slice(2);

if (!attestation || !recipient || !amount) {
  console.error('Usage: node scripts/cctp-mint.mjs <attestation> <recipient> <amount>');
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  message: 'CCTP mint simulated — integrate with Injective CCTP CosmWasm contract',
  attestation,
  recipient,
  amount,
  note: 'Replace this script with a CosmWasm execute call to the CCTP contract on Injective',
}, null, 2));
