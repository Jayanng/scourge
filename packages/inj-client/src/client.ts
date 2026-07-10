/**
 * Live CosmWasm client for Kickoff markets on Injective.
 * Signs with DEPLOYER_PRIVATE_KEY via MsgBroadcasterWithPk.
 */
import {
  ChainGrpcWasmApi,
  MsgBroadcasterWithPk,
  MsgExecuteContractCompat,
  PrivateKey,
} from '@injectivelabs/sdk-ts';
import { Network, getNetworkEndpoints } from '@injectivelabs/networks';
import { betHookMsg, claimMsg, createMarketMsg, settleMsg, type Outcome, type Side } from './messages.js';
import { loadPrivateKeyWallet, normalizePrivateKeyHex } from './wallet.js';

export interface InjectiveNetworkConfig {
  network: 'testnet' | 'mainnet';
  chainId: string;
  lcd: string;
  rpc: string;
  grpc: string;
  marketFactoryAddress?: string;
  usdcCw20Address?: string;
  privateKeyHex?: string;
}

export function getDefaultTestnetConfig(): InjectiveNetworkConfig {
  return {
    network: (process.env.INJECTIVE_NETWORK as 'testnet' | 'mainnet') ?? 'testnet',
    chainId: process.env.INJECTIVE_CHAIN_ID ?? 'injective-888',
    lcd: process.env.INJECTIVE_LCD ?? 'https://testnet.sentry.lcd.injective.network',
    rpc: process.env.INJECTIVE_RPC ?? 'https://testnet.sentry.tm.injective.network:443',
    grpc: process.env.INJECTIVE_GRPC ?? 'testnet.sentry.chain.grpc.injective.network:443',
    marketFactoryAddress: process.env.MARKET_FACTORY_ADDRESS,
    usdcCw20Address: process.env.USDC_CW20_ADDRESS,
    privateKeyHex: process.env.DEPLOYER_PRIVATE_KEY
      ? normalizePrivateKeyHex(process.env.DEPLOYER_PRIVATE_KEY)
      : undefined,
  };
}

function networkEnum(network: 'testnet' | 'mainnet'): Network {
  return network === 'mainnet' ? Network.Mainnet : Network.TestnetSentry;
}

export interface CreateMarketResult {
  txHash: string;
  /** Predicted / parsed market address when available from events */
  address?: string;
  matchId?: string;
  template?: string;
}

export interface TxResult {
  txHash: string;
}

export function createInjClient(partial?: Partial<InjectiveNetworkConfig>) {
  const config = { ...getDefaultTestnetConfig(), ...partial };

  const wallet = partial?.privateKeyHex
    ? {
        privateKeyHex: normalizePrivateKeyHex(partial.privateKeyHex),
        address: partial.privateKeyHex
          ? PrivateKey.fromHex(normalizePrivateKeyHex(partial.privateKeyHex)).toBech32()
          : undefined,
      }
    : loadPrivateKeyWallet();

  const privateKey = PrivateKey.fromHex(wallet.privateKeyHex);
  const sender = wallet.address ?? privateKey.toBech32();

  const network = networkEnum(config.network);
  // sdk-ts ChainGrpc* clients expect grpc-web HTTPS endpoints from networks package.
  // Raw host:port from INJECTIVE_GRPC is for injectived CLI only — do not pass it here.
  const endpoints = getNetworkEndpoints(network);
  const rest = config.lcd?.startsWith('http') ? config.lcd : endpoints.rest;
  const grpc = endpoints.grpc;

  const broadcaster = new MsgBroadcasterWithPk({
    privateKey,
    network,
    endpoints: {
      indexer: endpoints.indexer,
      grpc,
      rest,
    },
    simulateTx: true,
    gasBufferCoefficient: 1.3,
  });

  const wasmApi = new ChainGrpcWasmApi(grpc);

  async function broadcastExec(
    contractAddress: string,
    msg: Record<string, unknown>,
    funds: { denom: string; amount: string }[] = [],
  ): Promise<TxResult> {
    const execMsg = MsgExecuteContractCompat.fromJSON({
      sender,
      contractAddress,
      msg,
      funds,
    });
    const res = await broadcaster.broadcast({ msgs: execMsg });
    const txHash = (res as { txHash?: string; txhash?: string }).txHash
      ?? (res as { txhash?: string }).txhash
      ?? String(res);
    return { txHash };
  }

  async function querySmart<T>(contractAddress: string, query: Record<string, unknown>): Promise<T> {
    const raw = await wasmApi.fetchSmartContractState(
      contractAddress,
      Buffer.from(JSON.stringify(query)).toString('base64'),
    );
    const data = (raw as { data?: Uint8Array | string }).data ?? raw;
    if (typeof data === 'string') {
      return JSON.parse(Buffer.from(data, 'base64').toString('utf8')) as T;
    }
    if (data instanceof Uint8Array) {
      return JSON.parse(Buffer.from(data).toString('utf8')) as T;
    }
    // some versions return already-decoded object under .data
    return data as T;
  }

  return {
    config,
    sender,
    wasmApi,

    async createMarket(
      question: string,
      closesAt: number,
      meta?: { matchId?: string; template?: string },
    ): Promise<CreateMarketResult> {
      const factory = config.marketFactoryAddress;
      if (!factory || !factory.startsWith('inj1') || factory.includes('...')) {
        throw new Error('MARKET_FACTORY_ADDRESS is not set to a valid inj1 address');
      }
      if (!config.usdcCw20Address || !config.usdcCw20Address.startsWith('inj1')) {
        throw new Error('USDC_CW20_ADDRESS is not set to a valid CW20 inj1 address');
      }
      // Guard against the bad factory that stored the EOA as USDC
      if (config.usdcCw20Address === sender) {
        throw new Error(
          'USDC_CW20_ADDRESS equals deployer — refuse to use a factory with a bad USDC pointer',
        );
      }

      const { txHash } = await broadcastExec(factory, createMarketMsg(question, closesAt));

      // Best-effort: list markets and take the latest
      let address: string | undefined;
      try {
        const markets = await querySmart<{ markets: string[] }>(factory, { markets: {} });
        if (markets.markets?.length) {
          address = markets.markets[markets.markets.length - 1];
        }
      } catch {
        // non-fatal
      }

      return {
        txHash,
        address,
        matchId: meta?.matchId,
        template: meta?.template,
      };
    },

    async placeBet(market: string, side: Side, amount: string): Promise<TxResult> {
      const usdc = config.usdcCw20Address;
      if (!usdc) throw new Error('USDC_CW20_ADDRESS unset');
      // CW20 Send → market Receive(BetMsg)
      const msg = {
        send: {
          contract: market,
          amount,
          msg: Buffer.from(JSON.stringify(betHookMsg(side))).toString('base64'),
        },
      };
      return broadcastExec(usdc, msg);
    },

    async settleMarket(market: string, outcome: Outcome): Promise<TxResult> {
      return broadcastExec(market, settleMsg(outcome));
    },

    async claim(market: string): Promise<TxResult> {
      return broadcastExec(market, claimMsg());
    },

    async queryMarketState(market: string) {
      return querySmart<{
        usdc: string;
        resolver: string;
        question: string;
        closes_at: number;
        outcome: Outcome | null;
        total_yes: string;
        total_no: string;
      }>(market, { state: {} });
    },

    async queryFactoryConfig() {
      const factory = config.marketFactoryAddress;
      if (!factory) throw new Error('MARKET_FACTORY_ADDRESS unset');
      return querySmart<{
        market_code_id: number;
        usdc: string;
        resolver: string;
      }>(factory, { config: {} });
    },

    async assertFactoryUsdcHealthy(): Promise<void> {
      const cfg = await this.queryFactoryConfig();
      if (!cfg.usdc.startsWith('inj1')) {
        throw new Error(`Factory USDC is invalid: ${cfg.usdc}`);
      }
      if (cfg.usdc === sender) {
        throw new Error(
          `Factory has bad USDC pointer (points at deployer EOA ${sender}). ` +
            'Use MARKET_FACTORY_ADDRESS=inj195ussuugvjzxfg2ndqtn8tcyv9r9yw4hmc7kpq',
        );
      }
      if (config.usdcCw20Address && cfg.usdc !== config.usdcCw20Address) {
        throw new Error(
          `Factory USDC ${cfg.usdc} != env USDC_CW20_ADDRESS ${config.usdcCw20Address}`,
        );
      }
    },
  };
}

export type InjClient = ReturnType<typeof createInjClient>;
