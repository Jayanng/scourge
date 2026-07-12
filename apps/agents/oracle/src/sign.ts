/**
 * Deterministic HMAC-SHA256 signing for oracle observations.
 *
 * Demo-grade: all oracles share a secret and are distinguished by their
 * `oracle` id. The Resolver (Prompt 7) verifies with the same secret before
 * counting an observation toward 2-of-3 consensus.
 */
import { createHmac } from 'node:crypto';
import type { OracleObservation } from '@kickoff/shared-types';

/** Fields that must be signed. Order is fixed and part of the protocol. */
export type SignableObservation = Omit<OracleObservation, 'signature'>;

/** Canonical string form — stable across processes and re-orders. */
export function canonicalObservation(o: SignableObservation): string {
  return [o.market, o.match_id, o.template, o.outcome, o.observed_at, o.oracle].join('|');
}

export function signObservation(o: SignableObservation, secret: string): string {
  return createHmac('sha256', secret).update(canonicalObservation(o)).digest('hex');
}

export function verifyObservation(o: OracleObservation, secret: string): boolean {
  const { signature, ...rest } = o;
  const expected = signObservation(rest, secret);
  // constant-length hex compare
  return signature.length === expected.length && timingSafeEqualHex(signature, expected);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
