'use client';

import { useStream } from '@/lib/useStream';
import { LiveMatch } from '@/components/LiveMatch';
import { Markets } from '@/components/Markets';
import { AgentActivity } from '@/components/AgentActivity';
import { CctpOnboard } from '@/components/CctpOnboard';

function Panel({
  title,
  subtitle,
  children,
  dot,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
  dot?: 'green' | 'red' | 'amber';
}) {
  const dotColor =
    dot === 'green'
      ? 'bg-pitch-500 animate-pulse-dot'
      : dot === 'red'
        ? 'bg-red-500'
        : dot === 'amber'
          ? 'bg-amber-500'
          : 'bg-pitch-700';
  return (
    <section className="panel flex min-h-[70vh] flex-col p-4 transition-all duration-300">
      <header className="mb-4 border-b border-pitch-700/50 pb-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${dotColor}`} />
          <h2 className="text-sm font-semibold uppercase tracking-widest text-pitch-400">
            {title}
          </h2>
        </div>
        <p className="mt-1 text-xs text-muted">{subtitle}</p>
      </header>
      <div className="panel-scroll flex-1 overflow-y-auto">{children}</div>
    </section>
  );
}

export default function HomePage() {
  const { agentActions, matchEvents, connected } = useStream();

  return (
    <main className="mx-auto min-h-screen max-w-[1600px] px-4 py-6 animate-fade-in">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="bg-gradient-to-r from-pitch-400 via-white to-pitch-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
            Kickoff Protocol
          </h1>
          <p className="mt-1 text-sm text-muted">
            Agent swarm · World Cup micro-markets · Injective-native
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full transition-all duration-500 ${
              connected
                ? 'bg-pitch-500 shadow-lg shadow-pitch-500/30'
                : 'bg-red-500'
            }`}
          />
          <span
            className={`rounded-full border px-3 py-1 font-mono text-xs transition-all duration-300 ${
              connected
                ? 'border-pitch-500/40 bg-pitch-800 text-pitch-400'
                : 'border-red-500/30 bg-red-900/20 text-red-400'
            }`}
          >
            {connected ? 'live' : 'offline'} · testnet
          </span>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <Panel
            title="Live Match"
            subtitle="Minute · score · events via SSE"
            dot={connected ? 'green' : 'red'}
          >
            <LiveMatch events={matchEvents} />
          </Panel>
        </div>
        <div className="lg:col-span-5">
          <Panel title="Markets" subtitle="Open micro-markets · live odds · bet">
            <Markets />
          </Panel>
        </div>
        <div className="lg:col-span-4">
          <Panel
            title="Agent Activity"
            subtitle="Bookmaker · Oracles · Resolver · Traders · x402"
          >
            <AgentActivity actions={agentActions} />
            <div className="mt-4">
              <CctpOnboard />
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}
