import { newRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Server-Sent Events stream of everything happening in the swarm:
 *   - agent.*.action  (bookmaker / oracle / resolver / trader activity)
 *   - match.*.event   (raw match feed)
 * The browser EventSource consumes this to drive the three dashboard panels.
 */
export async function GET() {
  const redis = newRedis();
  await redis.connect();

  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send('ready', { ts: Date.now() });

      const onAction = (_ch: string, message: string) => send('agent', JSON.parse(message));
      const onMatch = (_pat: string, _ch: string, message: string) =>
        send('match', JSON.parse(message));

      redis.on('message', onAction);
      redis.on('pmessage', onMatch);

      await redis.subscribe('agent.bookmaker.action', 'agent.oracle.action', 'agent.resolver.action', 'agent.trader.action');
      await redis.psubscribe('match.*.event');

      // Heartbeat keeps proxies from closing the idle connection.
      const hb = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          /* closed */
        }
      }, 15000);

      cleanup = () => {
        clearInterval(hb);
        redis.off('message', onAction);
        redis.off('pmessage', onMatch);
        redis.quit().catch(() => {});
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}
