/**
 * Long-lived MCP client singleton for the web frontend.
 *
 * Instead of spawning a fresh `tsx` subprocess on every bet request, we keep
 * one stdio connection alive. If the process dies, the next call reconnects.
 * The MCP server is the sole key-holder; the frontend never signs txs itself.
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === 'object' && 'text' in c ? String((c as any).text) : '',
      )
      .join('\n');
  }
  return String(content);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, '../../../../.env') });

const MCP_DIR = resolve(__dirname, '../../../mcp-server');
const isProd = process.env.NODE_ENV === 'production';

function spawnArgs(): { command: string; args: string[] } {
  if (isProd) {
    return { command: 'node', args: [resolve(MCP_DIR, 'dist/index.js')] };
  }
  const tsx = resolve(__dirname, '../../node_modules/.bin/tsx');
  return { command: tsx, args: [resolve(MCP_DIR, 'src/index.ts')] };
}

export interface BetResult {
  ok: boolean;
  text: string;
  error?: boolean;
}

// ---- Singleton MCP client ------------------------------------------------
interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
}

let _conn: McpConnection | null = null;

/** Ensure the MCP subprocess is running and return a connected client. */
async function getMcpClient(): Promise<Client> {
  if (_conn) {
    try {
      // Quick health check — ping the server
      await _conn.client.ping();
      return _conn.client;
    } catch {
      // Connection is stale — tear down and reconnect
      try {
        await _conn.client.close();
      } catch {
        /* ignore */
      }
      _conn = null;
    }
  }

  const { command, args } = spawnArgs();
  const client = new Client({ name: 'kickoff-web', version: '0.1.0' });
  const transport = new StdioClientTransport({
    command,
    args,
    cwd: MCP_DIR,
    env: { ...(process.env as Record<string, string>) },
    stderr: 'inherit',
  });

  await client.connect(transport);
  _conn = { client, transport };
  return client;
}

/**
 * Place a bet through the long-lived MCP client.
 * Reconnects automatically if the subprocess has died.
 */
export async function placeBetViaMcp(
  market: string,
  side: 'yes' | 'no',
  amount: string,
): Promise<BetResult> {
  const client = await getMcpClient();

  try {
    const res = await client.callTool({
      name: 'place_bet',
      arguments: { market, side, amount },
    });
    const text = asText(res.content);
    const isErr = Boolean((res as { isError?: boolean }).isError);
    return { ok: !isErr, text, error: isErr };
  } catch (e) {
    // If the call failed, tear down the stale connection so it's not orphaned
    const old = _conn;
    _conn = null;
    if (old) {
      try { await old.client.close(); } catch { /* ignore */ }
    }
    return { ok: false, text: String(e), error: true };
  }
}
