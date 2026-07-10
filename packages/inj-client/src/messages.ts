/**
 * Typed CosmWasm message helpers matching contracts/market + contracts/factory.
 * Wire to sdk-ts / cosmjs after testnet deploy (Prompt 3).
 */

export type Side = 'yes' | 'no';
export type Outcome = 'yes' | 'no' | 'void';

export interface MarketInstantiateMsg {
  usdc: string;
  resolver: string;
  question: string;
  closes_at: number;
}

export interface FactoryInstantiateMsg {
  market_code_id: number;
  usdc: string;
  resolver: string;
}

export function createMarketMsg(question: string, closes_at: number) {
  return { create_market: { question, closes_at } };
}

export function settleMsg(outcome: Outcome) {
  return { settle: { outcome } };
}

export function claimMsg() {
  return { claim: {} };
}

/** Payload for CW20 Send → market Receive hook */
export function betHookMsg(side: Side) {
  return { side };
}
