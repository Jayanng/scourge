'use client';

import { useMemo } from 'react';
import type { MatchEvent } from '@/lib/useStream';

const LABEL: Record<string, { text: string; color: string; icon: string }> = {
  kickoff: { text: 'Kickoff', color: 'text-pitch-400', icon: '⚽' },
  start: { text: 'Kickoff', color: 'text-pitch-400', icon: '⚽' },
  goal: { text: 'Goal', color: 'text-yellow-400', icon: '⚡' },
  corner: { text: 'Corner', color: 'text-blue-400', icon: '⤴' },
  yellow_card: { text: 'Yellow card', color: 'text-yellow-300', icon: '🟨' },
  yellow: { text: 'Yellow card', color: 'text-yellow-300', icon: '🟨' },
  red_card: { text: 'Red card', color: 'text-red-400', icon: '🟥' },
  shot_on_target: { text: 'Shot on target', color: 'text-orange-400', icon: '🎯' },
  shot: { text: 'Shot', color: 'text-orange-400', icon: '🎯' },
  substitution: { text: 'Substitution', color: 'text-purple-400', icon: '🔄' },
  full_time: { text: 'Full time', color: 'text-pitch-400', icon: '🏁' },
  ft: { text: 'Full time', color: 'text-pitch-400', icon: '🏁' },
};

const REGULAR_COLORS: Record<string, string> = {
  kickoff: 'border-pitch-700/40',
  start: 'border-pitch-700/40',
  goal: 'border-yellow-500/30 bg-yellow-500/5',
  corner: 'border-blue-500/30 bg-blue-500/5',
  yellow_card: 'border-yellow-300/20',
  yellow: 'border-yellow-300/20',
  red_card: 'border-red-500/30 bg-red-500/5',
};

export function LiveMatch({ events }: { events: MatchEvent[] }) {
  const byMatch = useMemo(() => {
    const map = new Map<string, MatchEvent[]>();
    for (const e of events) {
      const id = e.match_id ?? 'unknown';
      const arr = map.get(id) ?? [];
      arr.push(e);
      map.set(id, arr);
    }
    // newest first for a readable timeline
    for (const arr of map.values()) arr.reverse();
    return [...map.entries()];
  }, [events]);

  if (!byMatch.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-3 text-2xl animate-breathe">⏳</div>
        <p className="text-sm text-muted">Waiting for match feed…</p>
        <p className="mt-1 text-[10px] text-muted/60">Connect to data service to see live events</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {byMatch.map(([matchId, evs]) => {
        const minute = evs.reduce(
          (m, e) => Math.max(m, Number(e.minute ?? 0)),
          0,
        );
        return (
          <div
            key={matchId}
            className="animate-fade-in rounded-lg border border-pitch-700/40 bg-gradient-to-b from-pitch-900/60 to-pitch-900/30 p-3 transition-all duration-300 hover:border-pitch-700/60"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-xs text-pitch-400">
                {matchId}
              </span>
              <span className="animate-fade-in rounded-full bg-pitch-800/80 px-2 py-0.5 font-mono text-xs text-pitch-400">
                {minute}′
              </span>
            </div>
            <ul className="space-y-1 text-sm">
              {evs.slice(-12).map((e, i) => {
                const meta = LABEL[e.type ?? ''] ?? {
                  text: e.type ?? 'Event',
                  color: 'text-text',
                  icon: '•',
                };
                const borderColor =
                  REGULAR_COLORS[e.type ?? ''] ?? 'border-pitch-700/20';
                return (
                  <li
                    key={`${i}-${e.minute}-${e.type}`}
                    className={`animate-slide-in flex gap-2 rounded border-l-2 ${borderColor} pl-2 transition-all duration-200 hover:brightness-125`}
                    style={{ animationDelay: `${i * 40}ms` }}
                  >
                    <span className="w-10 shrink-0 text-right font-mono text-xs text-muted">
                      {e.minute}′
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="text-xs">{meta.icon}</span>
                      <span className={meta.color}>
                        {meta.text}
                        {e.player ? ` · ${e.player}` : ''}
                        {e.team_id ? (
                          <span className="text-muted"> ({e.team_id})</span>
                        ) : null}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
