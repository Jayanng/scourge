import { createSigner } from 'x402/types';
import { wrapFetchWithPayment } from 'x402-fetch';

export type X402Mode = 'live' | 'mock';

export interface X402ClientConfig {
  mode: X402Mode;
  facilitatorUrl?: string;
  payTo?: string;
  /** Private key hex string for signing x402 payments (EVM). */
  privateKey?: string;
  /** Network name for x402 (e.g. "base-sepolia", "base"). */
  network?: string;
  /** Max payment per request in USDC base units (6dp). Defaults to 0.10 USDC = 100000. */
  maxPayment?: string;
}

export interface X402Client {
  mode: X402Mode;
  /** The native fetch, wrapped with x402 auto-payment in 'live' mode. */
  fetch: typeof globalThis.fetch;
  /** Legacy pay() for mock compatibility. In live mode it still works via wrapped fetch. */
  pay(url: string, _amount?: string): Promise<{ ok: boolean; mode: X402Mode; txHash?: string }>;
}

let clientSingleton: X402Client | null = null;

export function createX402Client(config: X402ClientConfig): X402Client {
  if (config.mode !== 'live') {
    const c: X402Client = {
      mode: 'mock',
      fetch: globalThis.fetch,
      async pay(): Promise<{ ok: boolean; mode: X402Mode }> {
        return { ok: true, mode: 'mock' };
      },
    };
    clientSingleton = c;
    return c;
  }

  if (!config.privateKey) throw new Error('X402 live mode requires privateKey');

  const maxPayment = config.maxPayment ? BigInt(config.maxPayment) : BigInt(100_000);
  const network = config.network ?? 'base-sepolia';

  let wrappedFetch: typeof globalThis.fetch | null = null;
  const initFetch = async (): Promise<typeof globalThis.fetch> => {
    if (wrappedFetch) return wrappedFetch;
    const signer = await createSigner(network, config.privateKey! as `0x${string}`);
    wrappedFetch = wrapFetchWithPayment(globalThis.fetch, signer, maxPayment);
    return wrappedFetch;
  };

  const c: X402Client = {
    mode: 'live',
    fetch: new Proxy(globalThis.fetch, {
      apply(_target, _thisArg, args: Parameters<typeof globalThis.fetch>) {
        const fetchPromise = initFetch().then((fn) => fn(...args));
        return fetchPromise;
      },
    }),
    async pay(url: string, _amount?: string) {
      try {
        const fn = await initFetch();
        const res = await fn(url);
        const txHash = res.headers.get('x-x402-settlement') ?? undefined;
        return { ok: res.ok, mode: 'live', txHash };
      } catch {
        return { ok: false, mode: 'live', txHash: undefined };
      }
    },
  };
  clientSingleton = c;
  return c;
}

/** Reuse the singleton client if already created (agents share config). */
export function getX402Client(): X402Client | null {
  return clientSingleton;
}
