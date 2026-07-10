/**
 * Typed wrapper over @injectivelabs/sdk-ts for CosmWasm market ops.
 */

export {
  betHookMsg,
  claimMsg,
  createMarketMsg,
  settleMsg,
  type FactoryInstantiateMsg,
  type MarketInstantiateMsg,
  type Outcome,
  type Side,
} from './messages.js';

export {
  getDeployerPrivateKeyFromEnv,
  loadPrivateKeyWallet,
  normalizePrivateKeyHex,
  type PrivateKeyWalletConfig,
} from './wallet.js';

export {
  createInjClient,
  getDefaultTestnetConfig,
  type CreateMarketResult,
  type InjClient,
  type InjectiveNetworkConfig,
  type TxResult,
} from './client.js';
