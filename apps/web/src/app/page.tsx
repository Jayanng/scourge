/**
 * Three-panel shell: LiveMatch | Markets | Agent Activity.
 * Full UI lands in Prompt 9 / Days 12–13.
 */

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="panel flex min-h-[70vh] flex-col p-4">
      <header className="mb-4 border-b border-pitch-700/50 pb-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-pitch-400">
          {title}
        </h2>
        <p className="mt-1 text-xs text-muted">{subtitle}</p>
      </header>
      <div className="flex flex-1 items-center justify-center text-sm text-muted">
        {children ?? 'Scaffold — wire data in Prompt 9'}
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-[1600px] px-4 py-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Kickoff Protocol
          </h1>
          <p className="mt-1 text-sm text-muted">
            Agent swarm · World Cup micro-markets · Injective-native
          </p>
        </div>
        <div className="rounded-full border border-pitch-500/40 bg-pitch-800 px-3 py-1 font-mono text-xs text-pitch-400">
          testnet · scaffold
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-3">
          <Panel title="Live Match" subtitle="Minute · score · events via SSE" />
        </div>
        <div className="lg:col-span-5">
          <Panel title="Markets" subtitle="Open micro-markets · live odds · bet" />
        </div>
        <div className="lg:col-span-4">
          <Panel
            title="Agent Activity"
            subtitle="Bookmaker · Oracles · Resolver · Traders · x402"
          />
        </div>
      </div>
    </main>
  );
}
