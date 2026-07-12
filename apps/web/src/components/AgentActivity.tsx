'use client';

import type { AgentAction } from '@/lib/useStream';

const STYLE: Record<
  string,
  { color: string; border: string; dot: string; icon: string }
> = {
  bookmaker: {
    color: 'text-pitch-400',
    border: 'border-pitch-700/40',
    dot: 'bg-pitch-400',
    icon: '📋',
  },
  oracle: {
    color: 'text-cyan-300',
    border: 'border-cyan-700/40',
    dot: 'bg-cyan-400',
    icon: '👁',
  },
  resolver: {
    color: 'text-amber-300',
    border: 'border-amber-700/40',
    dot: 'bg-amber-400',
    icon: '⚖️',
  },
  trader: {
    color: 'text-fuchsia-300',
    border: 'border-fuchsia-700/40',
    dot: 'bg-fuchsia-400',
    icon: '💹',
  },
};

function agentMeta(a?: string): {
  label: string;
  style: (typeof STYLE)[keyof typeof STYLE];
} {
  if (!a) return { label: 'agent', style: STYLE.bookmaker };
  const key = a.replace(/-\d+$/, '');
  const s = STYLE[key] ?? STYLE.bookmaker;
  const label = a.startsWith('oracle-') || a.startsWith('trader-') ? a : key;
  return { label, style: s };
}

export function AgentActivity({ actions }: { actions: AgentAction[] }) {
  if (!actions.length) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <div className="mb-2 text-2xl animate-breathe">🤖</div>
        <p className="text-sm text-muted">Waiting for agent activity…</p>
        <p className="mt-1 text-[10px] text-muted/60">
          Agents will appear here as they create markets,
          <br />
          submit observations, reach consensus, and trade
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {actions.slice(0, 60).map((a, i) => {
        const { label, style } = agentMeta(a.agent);
        const p = a.payload ?? {};
        const summary = summarize(a, p);
        return (
          <div
            key={`${i}-${a.ts ?? ''}`}
            className={`animate-slide-in flex gap-2 rounded-md border-l-2 ${style.border} bg-pitch-900/30 px-2 py-1.5 transition-all duration-200 hover:brightness-125`}
            style={{ animationDelay: `${i * 30}ms` }}
          >
            {/* Timeline dot */}
            <div className="flex flex-col items-center gap-0.5 pt-1">
              <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
              {i < actions.length - 1 && (
                <span className="h-full w-px bg-pitch-700/30" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 text-xs font-semibold">
                  <span className="text-xs">{style.icon}</span>
                  <span className={style.color}>{label}</span>
                </span>
                <span className="shrink-0 rounded bg-pitch-800/60 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                  {a.action}
                </span>
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-text/90">
                {summary}
              </p>
              {a.marketId && (
                <p className="mt-0.5 truncate font-mono text-[10px] text-muted/70">
                  {a.marketId}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function summarize(
  a: AgentAction,
  p: Record<string, unknown>,
): string {
  switch (`${a.agent}:${a.action}`) {
    case 'bookmaker:market_created':
      return `${String(p.template ?? '')} · ${String(
        p.question ?? '',
      )}`;
    case 'oracle:observation': {
      const truth = (p as { truth?: string }).truth;
      const outcome = String(p.outcome ?? '');
      const matchStr =
        truth && truth !== outcome
          ? ` (truth: ${truth}, reports: ${outcome})`
          : truth
            ? ` (reports: ${outcome})`
            : ` (${outcome})`;
      return `reports ${outcome}${matchStr}${p.delivered === false ? ' ⚠️ undelivered' : ''}`;
    }
    case 'resolver:settle':
      return `settled ${String(p.outcome ?? '')} · winners [${String(
        (p as { winners?: number[] }).winners ?? '',
      )}]`;
    case 'trader:bet':
      return `bets ${String(p.side ?? '')} ${(
        Number(p.amount ?? 0) / 1e6
      ).toFixed(3)} USDC${p.reason ? ` · ${String(p.reason)}` : ''}`;
    default:
      return p.outcome
        ? `${String(p.outcome)}`
        : p.reason
          ? String(p.reason)
          : JSON.stringify(p).slice(0, 80);
  }
}
