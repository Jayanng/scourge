# Testnet deploy notes (Injective `injective-888`)

## Canonical addresses (use these)

| Role | Address / ID |
|------|----------------|
| Deployer / Resolver | `inj1lufzum44zdj4gl7pdaqrmz9lu8u4s9j0nay6mf` |
| Mock USDC (CW20) | `inj18zqkwf7c5ynhcnmx9gg8ty4m6dwqa9pkq6qshs` |
| **Market factory (good)** | `inj195ussuugvjzxfg2ndqtn8tcyv9r9yw4hmc7kpq` |
| Market code id | `39702` |
| Factory code id | `39703` |
| Mock USDC code id | `39704` |

## Bad factory pointer (do not use)

| | |
|--|--|
| Address | `inj12jvr7kwuzue3zmhalu0sg5t6adha58yanjeecv` |
| Problem | Instantiated when mock USDC create failed; `usdc` field was set to the **deployer EOA** instead of a CW20 |
| Fix | Abandoned. CosmWasm config is immutable without a migrate. Use the good factory above. |
| Guard | `@kickoff/inj-client` `assertFactoryUsdcHealthy()` refuses to run if factory `usdc == deployer` |

## Rebuild wasm

```bash
./scripts/build-wasm.sh   # Docker cosmwasm/optimizer when available
```

## MCP smoke

```bash
pnpm --filter @kickoff/mcp-server smoke
# create_market → place_bet → submit_observation ×2 → settle_market → claim
```
