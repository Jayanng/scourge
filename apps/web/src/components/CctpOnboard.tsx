'use client';

import { useState } from 'react';

export function CctpOnboard() {
  const [amount, setAmount] = useState('10');
  const [destination, setDestination] = useState('inj1');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Record<string, unknown> | null>(null);

  async function submit() {
    setBusy(true);
    setOut(null);
    try {
      const r = await fetch('/api/cctp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount, destination }),
      });
      setOut(await r.json());
    } catch (e) {
      setOut({ ok: false, error: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-fade-in rounded-lg border border-usdc/30 bg-gradient-to-b from-usdc/5 to-transparent p-3 transition-all duration-300 hover:border-usdc/50 hover:shadow-[0_0_16px_rgba(39,117,202,0.1)]">
      <p className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-widest text-usdc">
        <span>🌉</span>
        <span>CCTP Onboarding</span>
      </p>
      <p className="mb-3 text-xs text-muted">
        Burn USDC on Base → mint on Injective → fund a Trader.
        <span className="ml-1 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
          demo stub
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="USDC"
          className="w-20 rounded border border-usdc/20 bg-black/40 px-2 py-1 font-mono text-text outline-none transition-all duration-200 focus:border-usdc/50 focus:shadow-[0_0_8px_rgba(39,117,202,0.15)]"
        />
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="inj1… destination"
          className="w-56 rounded border border-usdc/20 bg-black/40 px-2 py-1 font-mono text-text outline-none transition-all duration-200 focus:border-usdc/50 focus:shadow-[0_0_8px_rgba(39,117,202,0.15)]"
        />
        <button
          onClick={submit}
          disabled={busy}
          className="relative overflow-hidden rounded-md border border-usdc/50 bg-usdc/20 px-3 py-1 text-usdc transition-all duration-200 hover:bg-usdc/30 hover:shadow-[0_0_12px_rgba(39,117,202,0.2)] disabled:opacity-40 disabled:hover:shadow-none"
        >
          {busy ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-usdc border-t-transparent" />
              <span>Burning</span>
            </span>
          ) : (
            'Burn & Bridge'
          )}
        </button>
      </div>
      {out && (
        <div className="mt-3 animate-fade-in rounded border border-usdc/20 bg-black/30 p-2">
          {out.ok ? (
            <>
              <p className="mb-1 text-xs text-pitch-400">✓ {String(out.message ?? 'Success')}</p>
              <pre className="whitespace-pre-wrap break-all text-[10px] text-muted/70">
                {JSON.stringify(
                  { amount: out.amount, destination: out.destination, burnHash: out.burnHash },
                  null,
                  2,
                )}
              </pre>
            </>
          ) : (
            <p className="text-xs text-red-400">✗ {String(out.error ?? 'Unknown error')}</p>
          )}
        </div>
      )}
    </div>
  );
}
