#!/usr/bin/env bash
# Deploy Kickoff Protocol CosmWasm contracts to Injective testnet.
# Auth: DEPLOYER_PRIVATE_KEY (preferred) or DEPLOYER_MNEMONIC (fallback).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
[[ -f "$ROOT/.env" ]] && set -a && source "$ROOT/.env" && set +a

ARTIFACTS="${ARTIFACTS_DIR:-$ROOT/artifacts}"
NETWORK="${INJECTIVE_NETWORK:-testnet}"
CHAIN_ID="${INJECTIVE_CHAIN_ID:-injective-888}"
NODE="${INJECTIVE_RPC:-https://testnet.sentry.tm.injective.network:443}"
FROM="${DEPLOYER_KEY_NAME:-deployer}"
FEES="${DEPLOY_FEES:-500000000000000inj}"
GAS="${DEPLOY_GAS:-3000000}"
YES_FLAG="${YES_FLAG:---yes}"
KEYRING="${KEYRING_BACKEND:-test}"

USDC="${USDC_CW20_ADDRESS:?Set USDC_CW20_ADDRESS to the CW20 USDC on testnet}"
RESOLVER="${RESOLVER_ADDRESS:?Set RESOLVER_ADDRESS to the resolver agent bech32 address}"

MARKET_WASM="${ARTIFACTS}/kickoff_market.wasm"
FACTORY_WASM="${ARTIFACTS}/kickoff_factory.wasm"

normalize_hex() {
  local k="${1:-}"
  k="${k#0x}"
  k="${k#0X}"
  k="$(echo "$k" | tr -d '[:space:]')"
  echo "$k"
}

import_deployer_key() {
  if [[ -n "${SKIP_KEY_IMPORT:-}" ]]; then
    return 0
  fi

  if injectived keys show "$FROM" -a --keyring-backend "$KEYRING" >/dev/null 2>&1; then
    echo "==> Key '$FROM' already in keyring ($KEYRING)"
    return 0
  fi

  if [[ -n "${DEPLOYER_PRIVATE_KEY:-}" ]]; then
    local hex
    hex="$(normalize_hex "$DEPLOYER_PRIVATE_KEY")"
    if [[ ! "$hex" =~ ^[0-9a-fA-F]{64}$ ]]; then
      echo "DEPLOYER_PRIVATE_KEY must be 64 hex characters (optionally 0x-prefixed)."
      exit 1
    fi
    echo "==> Importing private key as '$FROM' (ethsecp256k1)"
    # Injective uses Ethereum-style secp256k1 keys
    if injectived keys unsafe-import-eth-key "$FROM" "$hex" --keyring-backend "$KEYRING" 2>/dev/null; then
      return 0
    fi
    # Fallback flag spellings across injectived versions
    if injectived keys import-hex "$FROM" "$hex" --keyring-backend "$KEYRING" 2>/dev/null; then
      return 0
    fi
    echo "Failed to import private key. Try manually:"
    echo "  injectived keys unsafe-import-eth-key $FROM <hex> --keyring-backend $KEYRING"
    exit 1
  fi

  if [[ -n "${DEPLOYER_MNEMONIC:-}" ]]; then
    echo "==> Importing mnemonic as '$FROM' (legacy)"
    echo "$DEPLOYER_MNEMONIC" | injectived keys add "$FROM" --recover --keyring-backend "$KEYRING"
    return 0
  fi

  echo "Set DEPLOYER_PRIVATE_KEY (preferred) or DEPLOYER_MNEMONIC,"
  echo "or SKIP_KEY_IMPORT=1 if key '$FROM' already exists in the keyring."
  exit 1
}

if [[ ! -f "$MARKET_WASM" || ! -f "$FACTORY_WASM" ]]; then
  echo "Missing wasm artifacts. Expected:"
  echo "  $MARKET_WASM"
  echo "  $FACTORY_WASM"
  echo ""
  echo "Build with:  ./scripts/build-wasm.sh"
  exit 1
fi

if ! command -v injectived >/dev/null 2>&1; then
  echo "injectived not found in PATH. Install Injective CLI or set PATH."
  exit 1
fi

echo "==> Network: $NETWORK  chain-id: $CHAIN_ID"
echo "==> Node:    $NODE"
echo "==> From:    $FROM"

import_deployer_key

DEPLOYER_ADDR="$(injectived keys show "$FROM" -a --keyring-backend "$KEYRING")"
echo "==> Address: $DEPLOYER_ADDR"

TX() {
  injectived tx wasm "$@" \
    --from "$FROM" \
    --chain-id "$CHAIN_ID" \
    --node "$NODE" \
    --gas "$GAS" \
    --fees "$FEES" \
    --keyring-backend "$KEYRING" \
    $YES_FLAG \
    --broadcast-mode sync \
    -o json
}

echo "==> Storing market wasm"
MARKET_STORE_JSON=$(TX store "$MARKET_WASM")
echo "$MARKET_STORE_JSON" | head -c 500
echo ""

sleep "${TX_WAIT_SECS:-6}"

echo "==> Storing factory wasm"
FACTORY_STORE_JSON=$(TX store "$FACTORY_WASM")
echo "$FACTORY_STORE_JSON" | head -c 500
echo ""
sleep "${TX_WAIT_SECS:-6}"

if command -v jq >/dev/null 2>&1; then
  if [[ -z "${MARKET_CODE_ID:-}" || -z "${FACTORY_CODE_ID:-}" ]]; then
    echo "==> Querying wasm codes (set MARKET_CODE_ID / FACTORY_CODE_ID to skip)"
    injectived query wasm list-code --node "$NODE" -o json 2>/dev/null || echo '{}'
    echo "Tip: after store, set MARKET_CODE_ID and FACTORY_CODE_ID from explorer/tx logs."
  fi
fi

MARKET_CODE_ID="${MARKET_CODE_ID:?Set MARKET_CODE_ID after store (from tx events or explorer)}"
FACTORY_CODE_ID="${FACTORY_CODE_ID:?Set FACTORY_CODE_ID after store (from tx events or explorer)}"

echo "==> Market code id:  $MARKET_CODE_ID"
echo "==> Factory code id: $FACTORY_CODE_ID"

FACTORY_INIT=$(cat <<EOF
{"market_code_id":$MARKET_CODE_ID,"usdc":"$USDC","resolver":"$RESOLVER"}
EOF
)

echo "==> Instantiating factory"
INIT_JSON=$(TX instantiate "$FACTORY_CODE_ID" "$FACTORY_INIT" \
  --label "kickoff-factory" \
  --admin "$DEPLOYER_ADDR")
echo "$INIT_JSON" | head -c 800
echo ""
sleep "${TX_WAIT_SECS:-6}"

FACTORY_ADDRESS="${FACTORY_ADDRESS:-}"
if [[ -z "$FACTORY_ADDRESS" ]]; then
  echo ""
  echo "Set FACTORY_ADDRESS from instantiate tx events (_contract_address), then re-run print step."
  echo ""
  echo "Export for .env:"
  echo "  MARKET_CODE_ID=$MARKET_CODE_ID"
  echo "  FACTORY_CODE_ID=$FACTORY_CODE_ID"
  echo "  MARKET_FACTORY_ADDRESS=<from tx>"
  echo "  USDC_CW20_ADDRESS=$USDC"
  echo "  DEPLOYER_ADDRESS=$DEPLOYER_ADDR"
  echo "  RESOLVER_ADDRESS=${RESOLVER}"
  exit 0
fi

echo ""
echo "========================================"
echo " Deploy complete"
echo "========================================"
echo "  MARKET_CODE_ID=$MARKET_CODE_ID"
echo "  FACTORY_CODE_ID=$FACTORY_CODE_ID"
echo "  MARKET_FACTORY_ADDRESS=$FACTORY_ADDRESS"
echo "  USDC_CW20_ADDRESS=$USDC"
echo "  DEPLOYER_ADDRESS=$DEPLOYER_ADDR"
echo "  RESOLVER_ADDRESS=$RESOLVER"
echo "========================================"
