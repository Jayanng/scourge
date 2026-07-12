# Kickoff Protocol

**An autonomous agent swarm for World Cup micro-markets — native to Injective.**

Hackathon entry for [The Injective Global Cup](https://hackquest.io) (HackQuest) · July 3–19, 2026.

> A swarm of AI agents autonomously creates, resolves, and trades thousands of live World Cup micro-markets on Injective — paying each other in USDC via x402, with fans onboarding from any chain through CCTP.

## Why this exists

Polymarket and Kalshi list a few dozen World Cup markets. The long tail — *corner between minute 34–36*, *first yellow card before minute 20* — is uneconomical with human resolution. Kickoff productizes that gap with specialized agents that cost pennies per resolution.

## Required tech (all load-bearing)

| Tech | Role in Kickoff |
|------|-----------------|
| **x402** | Agent-to-agent USDC micropayments (oracle economy, signal subscriptions) |
| **CCTP** | Fan onboarding: burn USDC on Base → mint on Injective → fund a Trader |
| **Injective MCP Server** | Agents never hold keys; they call named tools (`create_market`, `place_bet`, …) |
| **Injective Agent Skills** | Agent boundary to chain operations |
| **CosmWasm on Injective** | Binary market + factory contracts (no EVM path) |

## Architecture (five layers)

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Next.js)  LiveMatch · Markets · Agent Activity   │
├─────────────────────────────────────────────────────────────┤
│  Agents   Bookmaker · Oracle×3 · Resolver · Trader×2        │
├─────────────────────────────────────────────────────────────┤
│  MCP Server + Agent Skills   create_market · settle · …     │
├─────────────────────────────────────────────────────────────┤
│  Payments   x402 (A2A USDC) · CCTP (cross-chain onboarding) │
├─────────────────────────────────────────────────────────────┤
│  Chain   CosmWasm factory + binary markets  (Injective)     │
└─────────────────────────────────────────────────────────────┘
         ▲
   Data layer: api-football + Redis event bus
```

### Market lifecycle

1. **Spawn** — Bookmaker reads match events, picks a template, calls MCP `create_market`
2. **Price** — Trader agents quote and bet in USDC
3. **Observe** — Oracles publish signed observations
4. **Settle** — Resolver applies 2-of-3 consensus, settles on-chain, pays accurate oracles via x402
5. **Payout** — Contract pays winners; frontend animates

## Monorepo layout

```
kickoff-protocol/
├── apps/
│   ├── web/                 # Next.js 14 frontend
│   ├── agents/
│   │   ├── bookmaker/
│   │   ├── oracle/          # INSTANCE=1|2|3
│   │   ├── resolver/
│   │   └── trader/          # PERSONA=ronaldo9|var
│   ├── mcp-server/          # Injective MCP tools
│   └── data/                # match feed + Redis
├── contracts/
│   ├── market/              # CosmWasm binary market
│   ├── factory/             # CosmWasm factory
│   └── mock-usdc/           # CW20-like USDC for demo
├── packages/
│   ├── shared-types/
│   ├── x402-client/
│   └── inj-client/
├── infra/
│   └── docker-compose.yml   # Redis 7 + Postgres 16
└── scripts/
```

## Prerequisites

- **Node.js** 20.x LTS
- **pnpm** 9.x
- **Docker** + Compose (Redis / Postgres)
- **Rust** 1.81+ + `wasm32-unknown-unknown` (for contracts)
- Optional: `injectived` 1.13+ for testnet deploy

## Quick start

```bash
# Install deps
pnpm install

# Infra
docker compose -f infra/docker-compose.yml up -d

# Env
cp .env.example .env

# Dev (all workspaces Turbo can run)
pnpm dev

# Or single apps
pnpm --filter @kickoff/web dev
pnpm --filter @kickoff/data dev
```

## Toolchain pins (Day 1)

| Tool | Version |
|------|---------|
| Node.js | 20.x LTS |
| pnpm | 9.x |
| TypeScript | 5.5.x |
| Turbo | 2.x |
| Next.js | 14.2.x |
| cosmwasm-std | 2.1.4 |

## Status

| Prompt | Deliverable | Status |
|--------|-------------|--------|
| 1 | Monorepo scaffold | ✅ |
| 2 | CosmWasm market + factory + tests + deploy scripts | ✅ |
| 3 | MCP server tools | ✅ |
| 4 | Data ingester + REPLAY_MODE | ✅ |
| 5 | Bookmaker agent | ✅ |
| 6 | Oracle×3 agents | ✅ |
| 7 | Resolver + x402 2-of-3 consensus | ✅ |
| 8 | Trader×2 agents | ✅ |
| 9 | Frontend polish + CCTP onboard | ✅ (CCTP stub) |
| 10 | Demo replay script | ✅ |

### Contracts + MCP quick check

```bash
source "$HOME/.cargo/env"
cargo test                                # multi-tests (repo-root Cargo workspace)
./scripts/build-wasm.sh                   # → artifacts/*.wasm (optimizer)
pnpm --filter @kickoff/mcp-server smoke   # live testnet e2e via MCP tools

# Data layer (Prompt 4)
docker compose -f infra/docker-compose.yml up -d
REPLAY_MODE=1 pnpm --filter @kickoff/data dev   # Redis match.*.event + :4001/health
```

See [docs/DEPLOY.md](./docs/DEPLOY.md) for testnet addresses and the deprecated bad factory.

## License

MIT

---

Built for **@HackQuest × @injective** · #InjectiveGlobalCup
