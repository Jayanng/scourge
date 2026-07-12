'use client';

import { useEffect, useRef, useState } from 'react';

export type AgentAction = {
  agent?: string;
  action?: string;
  matchId?: string;
  marketId?: string;
  payload?: Record<string, unknown>;
  ts?: number;
};

export type MatchEvent = {
  type?: string;
  minute?: number;
  player?: string;
  team_id?: string;
  match_id?: string;
  ts?: number;
};

export type StreamState = {
  agentActions: AgentAction[];
  matchEvents: MatchEvent[];
  connected: boolean;
};

const MAX = 400;

export function useStream() {
  const [state, setState] = useState<StreamState>({
    agentActions: [],
    matchEvents: [],
    connected: false,
  });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    esRef.current = es;

    es.addEventListener('ready', () => setState((s) => ({ ...s, connected: true })));
    es.addEventListener('agent', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as AgentAction;
        setState((s) => ({
          ...s,
          agentActions: [data, ...s.agentActions].slice(0, MAX),
          connected: true,
        }));
      } catch {
        /* ignore */
      }
    });
    es.addEventListener('match', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data) as MatchEvent;
        setState((s) => ({
          ...s,
          matchEvents: [data, ...s.matchEvents].slice(0, MAX),
          connected: true,
        }));
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => setState((s) => ({ ...s, connected: false }));

    return () => es.close();
  }, []);

  return state;
}
