import { fetch, type RequestInit, type Response } from 'undici';

export class RateLimitError extends Error {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** Fetch with exponential backoff on 429 / 5xx. */
export async function fetchWithBackoff(
  url: string,
  init: RequestInit = {},
  opts: { maxRetries?: number; baseMs?: number; label?: string } = {},
): Promise<Response> {
  const maxRetries = opts.maxRetries ?? 5;
  const baseMs = opts.baseMs ?? 500;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429) {
        const ra = res.headers.get('retry-after');
        const retryAfterMs = ra
          ? Number(ra) * (Number(ra) < 1000 ? 1000 : 1)
          : baseMs * 2 ** attempt;
        if (attempt === maxRetries) {
          throw new RateLimitError(
            `${opts.label ?? url} rate limited (429)`,
            retryAfterMs,
          );
        }
        await sleep(retryAfterMs);
        continue;
      }
      if (res.status >= 500 && attempt < maxRetries) {
        await sleep(baseMs * 2 ** attempt);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (e instanceof RateLimitError) throw e;
      if (attempt === maxRetries) throw e;
      await sleep(baseMs * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
