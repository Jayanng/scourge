# Kickoff CosmWasm contracts

Binary prediction markets on Injective (CosmWasm-native, no EVM).

| Crate | Role |
|-------|------|
| `kickoff-market` | Fixed-odds (parimutuel) binary market: CW20 bet → settle → claim |
| `kickoff-factory` | Spawns markets via `Instantiate2` + keccak salt + reply |

## Develop

```bash
# from repo root
source "$HOME/.cargo/env"
cd contracts
cargo test

# wasm artifacts → ../artifacts/
../scripts/build-wasm.sh
```

## Deploy (Injective testnet)

Requires `injectived`, funded key, and CW20 USDC address:

```bash
# Preferred: 64-char hex private key (optional 0x prefix)
export DEPLOYER_PRIVATE_KEY="0123abcd...64hex"
export USDC_CW20_ADDRESS=inj1...
export RESOLVER_ADDRESS=inj1...   # can match deployer address
# after store txs:
export MARKET_CODE_ID=...
export FACTORY_CODE_ID=...
./scripts/deploy.sh
```

Derive `inj1…` from the key (after `pnpm add -w @injectivelabs/sdk-ts`):

```bash
node scripts/addr-from-key.mjs
```

## Market flow

1. **Bet** — users `Cw20::Send` USDC to market with `{ "side": "yes" | "no" }`
2. **Settle** — resolver-only `Settle { outcome }`
3. **Claim** — winners pull parimutuel share; `Void` refunds both sides

Payout (Yes wins): `stake_yes * (total_yes + total_no) / total_yes`
