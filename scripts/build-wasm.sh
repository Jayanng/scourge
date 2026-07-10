#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$HOME/.cargo/env" 2>/dev/null || true
export RUSTFLAGS="-C link-arg=-s -C link-arg=--allow-undefined -C target-feature=-bulk-memory,-sign-ext -C target-cpu=mvp"
cd "$ROOT"
# Prefer optimizer when docker available
if command -v docker >/dev/null 2>&1; then
  echo "==> cosmwasm/optimizer"
  docker run --rm -v "$ROOT":/code \
    --mount type=volume,source=kickoff_opt_cache,target=/target \
    --mount type=volume,source=kickoff_reg,target=/usr/local/cargo/registry \
    cosmwasm/optimizer:0.16.1
  ls -lh "$ROOT/artifacts"/*.wasm
  exit 0
fi
rustup toolchain install 1.81.0 >/dev/null 2>&1 || true
rustup target add wasm32-unknown-unknown --toolchain 1.81.0 >/dev/null 2>&1 || true
cargo +1.81.0 build --release --lib --target wasm32-unknown-unknown \
  -p kickoff-market -p kickoff-factory -p kickoff-mock-usdc
mkdir -p artifacts
cp target/wasm32-unknown-unknown/release/kickoff_*.wasm artifacts/
ls -lh artifacts/*.wasm
