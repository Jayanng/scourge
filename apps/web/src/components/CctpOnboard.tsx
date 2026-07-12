'use client';

import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useWalletClient } from 'wagmi';
import { baseSepolia } from 'wagmi/chains';

const USDC_CCTP = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const TOKEN_MESSENGER = '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5';

export function CctpOnboard() {
  const [amount, setAmount] = useState('10');
  const [destination, setDestination] = useState('inj1');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Record<string, unknown> | null>(null);

  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: walletClient } = useWalletClient();

  const onBaseSepolia = isConnected && chainId === baseSepolia.id;

  async function approveAndBurn() {
    if (!walletClient || !address) return;
    setBusy(true);
    setOut(null);

    try {
      const burnAmount = BigInt(Math.floor(Number(amount) * 1_000_000));

      // Step 1: Approve TokenMessenger to spend USDC
      const approveHash = await walletClient.writeContract({
        address: USDC_CCTP,
        abi: [{
          name: 'approve',
          type: 'function',
          inputs: [
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
          ],
          outputs: [{ name: '', type: 'bool' }],
          stateMutability: 'nonpayable',
        }],
        functionName: 'approve',
        args: [TOKEN_MESSENGER, burnAmount],
        chain: baseSepolia,
      });

      // Step 2: Call depositForBurn on TokenMessenger
      const burnHash = await walletClient.writeContract({
        address: TOKEN_MESSENGER,
        abi: [{
          name: 'depositForBurn',
          type: 'function',
          inputs: [
            { name: 'amount', type: 'uint256' },
            { name: 'destinationDomain', type: 'uint32' },
            { name: 'mintRecipient', type: 'bytes32' },
            { name: 'burnToken', type: 'address' },
          ],
          outputs: [{ name: '', type: 'bytes64' }],
          stateMutability: 'nonpayable',
        }],
        functionName: 'depositForBurn',
        args: [
          burnAmount,
          7, // Injective domain ID on CCTP
          `0x000000000000000000000000${destination.slice(2).padStart(40, '0')}`,
          USDC_CCTP,
        ],
        chain: baseSepolia,
      });

      // Step 3: Send the burn tx hash to our backend for attestation polling
      const r = await fetch('/api/cctp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amount,
          destination,
          burnTxHash: burnHash,
          mode: 'live',
        }),
      });
      const data = await r.json();
      setOut({ ...data, approveTx: approveHash, burnTx: burnHash });
    } catch (e) {
      setOut({ ok: false, error: String(e) });
    } finally {
      setBusy(false);
    }
  }

  // Stub mode for when no wallet is connected
  async function submitStub() {
    setBusy(true);
    setOut(null);
    try {
      const r = await fetch('/api/cctp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amount, destination, mode: 'mock' }),
      });
      setOut(await r.json());
    } catch (e) {
      setOut({ ok: false, error: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-fade-in rounded-lg border border-usdc/30 bg-gradient-to-b from-usdc/5 to-transparent p-3 transition-all duration-300 hover:border-usdc/50 hover:shadow-[0_0_16px_rgba(39,117,202,0.1)]">
      <p className="mb-1 flex items-center gap-1.5 text-xs uppercase tracking-widest text-usdc">
        <span>🌉</span>
        <span>CCTP Onboarding</span>
      </p>
      <p className="mb-3 text-xs text-muted">
        Burn USDC on Base → mint on Injective → fund a Trader.
        {!isConnected && (
          <span className="ml-1 rounded bg-amber-900/30 px-1.5 py-0.5 text-[10px] text-amber-400">
            demo stub
          </span>
        )}
      </p>

      {/* Wallet connect */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {!isConnected ? (
          <button
            onClick={() => connect({ connector: connectors[0] })}
            className="rounded border border-usdc/30 bg-usdc/10 px-3 py-1 text-usdc transition-all hover:bg-usdc/20"
          >
            Connect Base Sepolia
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-usdc">
              {onBaseSepolia ? '✓ Base Sepolia' : '⚠ Switch to Base Sepolia'}
            </span>
            <span className="text-[10px] text-muted">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
            <button
              onClick={() => disconnect()}
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              disconnect
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="USDC"
          className="w-20 rounded border border-usdc/20 bg-black/40 px-2 py-1 font-mono text-text outline-none transition-all duration-200 focus:border-usdc/50 focus:shadow-[0_0_8px_rgba(39,117,202,0.15)]"
        />
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="inj1… destination"
          className="w-56 rounded border border-usdc/20 bg-black/40 px-2 py-1 font-mono text-text outline-none transition-all duration-200 focus:border-usdc/50 focus:shadow-[0_0_8px_rgba(39,117,202,0.15)]"
        />
        <button
          onClick={onBaseSepolia ? approveAndBurn : submitStub}
          disabled={busy}
          className="relative overflow-hidden rounded-md border border-usdc/50 bg-usdc/20 px-3 py-1 text-usdc transition-all duration-200 hover:bg-usdc/30 hover:shadow-[0_0_12px_rgba(39,117,202,0.2)] disabled:opacity-40 disabled:hover:shadow-none"
        >
          {busy ? (
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-usdc border-t-transparent" />
              <span>{onBaseSepolia ? 'Burning' : 'Simulating'}</span>
            </span>
          ) : (
            onBaseSepolia ? 'Approve & Burn' : 'Burn & Bridge (Stub)'
          )}
        </button>
      </div>

      {out && (
        <div className="mt-3 animate-fade-in rounded border border-usdc/20 bg-black/30 p-2">
          {out.ok ? (
            <>
              <p className="mb-1 text-xs text-pitch-400">
                ✓ {String(out.message ?? 'Success')}
              </p>
              {(out as Record<string, unknown>).stub && (
                <p className="mb-1 text-[10px] text-amber-400">
                  This is a simulated burn. Connect a Base Sepolia wallet for a real CCTP transaction.
                </p>
              )}
              <pre className="whitespace-pre-wrap break-all text-[10px] text-muted/70">
                {JSON.stringify(
                  {
                    amount: out.amount,
                    destination: out.destination,
                    burnHash: out.burnHash ?? out.burnTx,
                    approveTx: (out as Record<string, unknown>).approveTx,
                    burnTx: (out as Record<string, unknown>).burnTx,
                    attestationUrl: (out as Record<string, unknown>).attestationUrl,
                    next: (out as Record<string, unknown>).next,
                  },
                  null,
                  2,
                )}
              </pre>
            </>
          ) : (
            <p className="text-xs text-red-400">✗ {String(out.error ?? 'Unknown error')}</p>
          )}
        </div>
      )}
    </div>
  );
}
