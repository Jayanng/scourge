#!/usr/bin/env node
/**
 * Derive Injective inj1… address from a hex private key (no mnemonic).
 *
 * Usage:
 *   node scripts/addr-from-key.mjs
 *   # reads DEPLOYER_PRIVATE_KEY from env / .env
 *
 *   DEPLOYER_PRIVATE_KEY=0xabc... node scripts/addr-from-key.mjs
 *
 * Prefers @injectivelabs/sdk-ts when installed; otherwise prints install hint.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  const p = resolve(root, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function normalizeHex(raw) {
  if (!raw) return '';
  let h = String(raw).trim().replace(/^0x/i, '');
  h = h.replace(/\s+/g, '');
  return h;
}

loadDotEnv();

const hex = normalizeHex(process.env.DEPLOYER_PRIVATE_KEY || process.argv[2]);
if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
  console.error(
    'Provide a 64-char hex private key via DEPLOYER_PRIVATE_KEY or argv[2] (optional 0x).',
  );
  process.exit(1);
}

async function main() {
  try {
    const { PrivateKey } = await import('@injectivelabs/sdk-ts');
    const pk = PrivateKey.fromHex(hex);
    const address = pk.toBech32();
    const pubkey = pk.toPublicKey().toBase64();
    console.log(JSON.stringify({ address, pubkeyEncoding: 'base64', pubkey }, null, 2));
  } catch (e) {
    if (e && (e.code === 'ERR_MODULE_NOT_FOUND' || String(e).includes('Cannot find'))) {
      console.error('Install the Injective SDK first:');
      console.error('  pnpm add -w @injectivelabs/sdk-ts');
      console.error('Or import into injectived:');
      console.error(
        '  injectived keys unsafe-import-eth-key deployer <hex> --keyring-backend test',
      );
      console.error('  injectived keys show deployer -a --keyring-backend test');
      process.exit(2);
    }
    throw e;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
