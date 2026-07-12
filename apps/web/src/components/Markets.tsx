'use client';

import { useEffect, useState, useCallback } from 'react';

type Market = {
  id: number;
  contract_address: string | null;
  match_id: string;
  template: string;
  question: string;
  closes_at: number | null;
  status: string;
  meta?: Record<string, unknown>;
};

function fmtClose(ts: number | null): string {
  if (!ts) return '—';
  const now = Date.now();
  const diff = ts * 1000 - now;
  if (diff <= 0) return 'closing…';
  const mins = Math.ceil(diff / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

const TEMPLATE_ICON: Record<string, string> = {
  match_winner: '🏆',
  next_goal_within: '⚡',
  corner_between_minutes: '⤴',
  player_sot_over: '🎯',
  first_yellow_before: '🟨',
};

export function Markets() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [side, setSide] = useState<'yes' | 'no'>('yes');
  const [amount, setAmount] = useState('1000000');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/markets');
      const j = await r.json();
      if (j.ok) setMarkets(j.markets ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function placeBet(market: string, betSide?: 'yes' | 'no') {
    setBusy(market);
    setResult(null);
    const s = betSide ?? side;
    try {
      const r = await fetch('/api/bet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ market, side: s, amount }),
      });
      const j = await r.json();
      setResult(j.text ?? (j.ok ? 'ok' : j.error));
    } catch (e) {
      setResult(String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!markets.length) {
    return (
      <div className="space-y-3">
        <div className="flex flex-col items-center justify-center py-8">
          <div className="mb-2 text-2xl animate-breathe">📊</div>
          <p className="text-sm text-muted">
            No markets yet — start the Bookmaker agent.
          </p>
        </div>
        <ManualBet
          target={target}
          setTarget={setTarget}
          side={side}
          setSide={setSide}
          amount={amount}
          setAmount={setAmount}
          busy={busy !== null}
          result={result}
          onBet={() => target && placeBet(target)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] uppercase tracking-widest text-muted/60">
          {markets.length} market{markets.length !== 1 ? 's' : ''} open
        </span>
      </div>
      {markets.map((m, idx) => (
        <div
          key={m.id}
          className="animate-fade-in rounded-lg border border-pitch-700/40 bg-gradient-to-b from-pitch-900/60 to-pitch-900/30 p-3 transition-all duration-300 hover:border-pitch-700/60 hover:shadow-lg hover:shadow-pitch-500/5"
          style={{ animationDelay: `${idx * 60}ms` }}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm text-text">{m.question}</p>
            <span className="flex shrink-0 items-center gap-1 rounded bg-pitch-800/80 px-2 py-0.5 font-mono text-xs text-pitch-400">
              {TEMPLATE_ICON[m.template] ?? '📋'} {m.template}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2 font-mono text-xs text-muted">
            <span className="rounded bg-pitch-800/50 px-1.5 py-0.5">
              {fmtClose(m.closes_at)}
            </span>
            <span
              className={`${
                m.status === 'settled'
                  ? 'text-pitch-400'
                  : m.status === 'closed'
                    ? 'text-amber-400'
                    : 'text-muted'
              }`}
            >
              {m.status}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => placeBet(m.contract_address ?? '')}
              disabled={busy !== null || !m.contract_address}
              className="group relative flex-1 overflow-hidden rounded-md border border-pitch-500/50 bg-pitch-800/80 px-2 py-1.5 text-xs text-pitch-400 transition-all duration-200 hover:bg-pitch-700 hover:shadow-[0_0_12px_rgba(34,197,94,0.15)] disabled:opacity-40 disabled:hover:shadow-none"
            >
              <span className="relative z-10 flex items-center justify-center gap-1">
                {busy === m.contract_address ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-pitch-400 border-t-transparent" />
                ) : null}
                Bet Yes
              </span>
              <span className="absolute inset-0 translate-y-full bg-gradient-to-t from-pitch-500/10 to-transparent transition-transform duration-300 group-hover:translate-y-0" />
            </button>
            <button
              onClick={() => placeBet(m.contract_address ?? '', 'no')}
              disabled={busy !== null || !m.contract_address}
              className="group relative flex-1 overflow-hidden rounded-md border border-red-500/40 bg-red-900/30 px-2 py-1.5 text-xs text-red-300 transition-all duration-200 hover:bg-red-900/50 hover:shadow-[0_0_12px_rgba(239,68,68,0.15)] disabled:opacity-40 disabled:hover:shadow-none"
            >
              <span className="relative z-10 flex items-center justify-center gap-1">
                {busy === m.contract_address ? (
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-red-400 border-t-transparent" />
                ) : null}
                Bet No
              </span>
              <span className="absolute inset-0 translate-y-full bg-gradient-to-t from-red-500/10 to-transparent transition-transform duration-300 group-hover:translate-y-0" />
            </button>
          </div>
        </div>
      ))}
      <ManualBet
        target={target}
        setTarget={setTarget}
        side={side}
        setSide={setSide}
        amount={amount}
        setAmount={setAmount}
        busy={busy !== null}
        result={result}
        onBet={() => target && placeBet(target)}
      />
    </div>
  );
}

function ManualBet(props: {
  target: string;
  setTarget: (v: string) => void;
  side: 'yes' | 'no';
  setSide: (v: 'yes' | 'no') => void;
  amount: string;
  setAmount: (v: string) => void;
  busy: boolean;
  result: string | null;
  onBet: () => void;
}) {
  return (
    <div className="animate-fade-in rounded-lg border border-pitch-700/30 bg-pitch-900/40 p-3 transition-all duration-300 hover:border-pitch-700/50">
      <p className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-widest text-pitch-400">
        <span>🔧</span>
        <span>Manual bet (any market)</span>
      </p>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={props.target}
          onChange={(e) => props.setTarget(e.target.value)}
          placeholder="inj1… market address"
          className="w-44 rounded border border-pitch-700/30 bg-black/40 px-2 py-1 font-mono text-text outline-none transition-all duration-200 focus:border-pitch-500/50 focus:shadow-[0_0_8px_rgba(34,197,94,0.1)]"
        />
        <select
          value={props.side}
          onChange={(e) => props.setSide(e.target.value as 'yes' | 'no')}
          className="rounded border border-pitch-700/30 bg-black/40 px-2 py-1 text-text outline-none transition-all duration-200 focus:border-pitch-500/50"
        >
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
        <input
          value={props.amount}
          onChange={(e) => props.setAmount(e.target.value)}
          placeholder="amount (micro-USDC)"
          className="w-36 rounded border border-pitch-700/30 bg-black/40 px-2 py-1 font-mono text-text outline-none transition-all duration-200 focus:border-pitch-500/50 focus:shadow-[0_0_8px_rgba(34,197,94,0.1)]"
        />
        <button
          onClick={props.onBet}
          disabled={props.busy}
          className="rounded-md border border-pitch-500/50 bg-pitch-800/80 px-3 py-1 text-pitch-400 transition-all duration-200 hover:bg-pitch-700 hover:shadow-[0_0_12px_rgba(34,197,94,0.15)] disabled:opacity-40"
        >
          {props.busy ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-pitch-400 border-t-transparent" />
              <span>Betting</span>
            </span>
          ) : (
            'Place'
          )}
        </button>
      </div>
      {props.result && (
        <pre className="mt-2 whitespace-pre-wrap break-all text-xs text-muted">
          {props.result}
        </pre>
      )}
    </div>
  );
}
