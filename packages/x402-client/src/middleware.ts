import type { IncomingMessage, ServerResponse } from 'node:http';
import { decodePayment } from 'x402/schemes';
import { useFacilitator } from 'x402/verify';
import type { FacilitatorConfig } from 'x402/types';
import { toJsonSafe } from 'x402/shared';
import { settleResponseHeader } from 'x402/types';
import type { PaymentRequirements } from 'x402/types';

export type { FacilitatorConfig };

export interface X402ServerConfig {
  payTo: string;
  network: string;
  price: string;
  facilitator?: FacilitatorConfig;
  description?: string;
  evmPayTo?: `0x${string}`;
}

const DEFAULT_FACILITATOR = 'https://x402.org/facilitator';

function isTLS(req: IncomingMessage): boolean {
  const sock = req.socket as { encrypted?: boolean };
  return sock.encrypted === true;
}

function makeProtocol(req: IncomingMessage): 'https' | 'http' {
  return isTLS(req) ? 'https' : 'http';
}

export function createPaymentRequirements(cfg: X402ServerConfig, resource: string): PaymentRequirements[] {
  const payTo = cfg.evmPayTo ?? cfg.payTo;
  return [{
    scheme: 'exact',
    network: cfg.network as PaymentRequirements['network'],
    maxAmountRequired: cfg.price,
    resource,
    description: cfg.description ?? '',
    mimeType: 'application/json',
    payTo,
    maxTimeoutSeconds: 60,
    asset: payTo,
    outputSchema: undefined,
    extra: undefined,
  }];
}

function send402(res: ServerResponse, req: IncomingMessage, cfg: X402ServerConfig): void {
  const protocol = makeProtocol(req);
  const host = req.headers.host ?? 'localhost';
  const resource = `${protocol}://${host}${req.url}`;
  const paymentRequirements = createPaymentRequirements(cfg, resource);

  res.writeHead(402, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    x402Version: 1,
    accepts: toJsonSafe(paymentRequirements),
  }));
}

export async function verifyX402Payment(
  req: IncomingMessage,
  res: ServerResponse,
  cfg: X402ServerConfig,
): Promise<boolean> {
  const paymentHeader = req.headers['x-x402-payment'] as string | undefined;

  if (!paymentHeader) {
    send402(res, req, cfg);
    return false;
  }

  let payment: ReturnType<typeof decodePayment>;
  try {
    payment = decodePayment(paymentHeader);
  } catch {
    send402(res, req, cfg);
    return false;
  }

  const protocol = makeProtocol(req);
  const host = req.headers.host ?? 'localhost';
  const resource = `${protocol}://${host}${req.url}`;
  const paymentRequirements = createPaymentRequirements(cfg, resource);

  const facilitator = useFacilitator(
    cfg.facilitator ?? { url: DEFAULT_FACILITATOR as `${string}://${string}` },
  );

  try {
    const verifyResult = await facilitator.verify(payment, paymentRequirements[0]);
    if (!(verifyResult as { success?: boolean }).success) {
      send402(res, req, cfg);
      return false;
    }

    const settleResult = await facilitator.settle(payment, paymentRequirements[0]);

    if (!settleResult.success) {
      send402(res, req, cfg);
      return false;
    }

    const responseHeader = settleResponseHeader(settleResult);
    (res as unknown as { __x402Settlement?: string }).__x402Settlement = responseHeader;
    return true;
  } catch {
    send402(res, req, cfg);
    return false;
  }
}

export function setX402ResponseHeader(res: ServerResponse): void {
  const header = (res as unknown as { __x402Settlement?: string }).__x402Settlement;
  if (header) {
    res.setHeader('X-PAYMENT-RESPONSE', header);
  }
}
