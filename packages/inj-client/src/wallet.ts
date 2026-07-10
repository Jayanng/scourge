/**
 * Private-key based wallet helpers for Injective (ethsecp256k1).
 * Prefer DEPLOYER_PRIVATE_KEY over mnemonics.
 */

export function normalizePrivateKeyHex(raw: string): string {
  const hex = raw.trim().replace(/^0x/i, '').replace(/\s+/g, '');
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('Private key must be 64 hex characters (optionally 0x-prefixed)');
  }
  return hex.toLowerCase();
}

export function getDeployerPrivateKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const pk = env.DEPLOYER_PRIVATE_KEY?.trim();
  if (pk) return normalizePrivateKeyHex(pk);
  return undefined;
}

/**
 * Returns config for signing with a raw hex private key.
 * Full PrivateKey / Msg signing is wired when @injectivelabs/sdk-ts is a dependency
 * of the consuming app (MCP / agents).
 */
export interface PrivateKeyWalletConfig {
  privateKeyHex: string;
  /** Optional pre-known inj1 address */
  address?: string;
}

export function loadPrivateKeyWallet(
  env: NodeJS.ProcessEnv = process.env,
): PrivateKeyWalletConfig {
  const privateKeyHex = getDeployerPrivateKeyFromEnv(env);
  if (!privateKeyHex) {
    throw new Error(
      'Set DEPLOYER_PRIVATE_KEY (64 hex chars). Mnemonic auth is deprecated for this project.',
    );
  }
  return {
    privateKeyHex,
    address: env.DEPLOYER_ADDRESS || undefined,
  };
}
