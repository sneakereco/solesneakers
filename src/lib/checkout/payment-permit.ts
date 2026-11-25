import { randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { env } from "@/config/env";
import {
  issuingPaymentPermitSchema,
  readPaymentPermit,
  type ConsumedPaymentPermit,
} from "@/Modules/Checkout/Source/Features/ContractCompatibility/payment-permit-reader";

export type PaymentMethod = "card" | "afterpay" | "applePay" | "cashAppPay";

export type PaymentPermitPayload = {
  attemptId?: string;
  ownerBinding?: string;
  tenantId: string;
  orderId: string;
  cartHash: string;
  totalCents: number;
  method: PaymentMethod;
  deviceSessionId: string;
  normalizedEmailHash: string;
  squareIdempotencyKey: string;
};

type RedisPermitClient = {
  set(key: string, value: string, options: { nx: true; ex: number }): Promise<unknown>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};

const CONSUME_SCRIPT = `
local value = redis.call("GET", KEYS[1])
if not value then
  return nil
end
redis.call("DEL", KEYS[1])
return value
`;

const PERMIT_TTL_SECONDS = 120;

export class PaymentPermitStore {
  constructor(
    private readonly redis: RedisPermitClient,
    private readonly createToken: () => string = randomUUID,
  ) {}

  async issue(
    payload: PaymentPermitPayload,
  ): Promise<{ token: string; expiresInSeconds: number }> {
    const parsed = issuingPaymentPermitSchema.parse(payload);
    const token = this.createToken();

    try {
      const result = await this.redis.set(this.key(token), JSON.stringify(parsed), {
        nx: true,
        ex: PERMIT_TTL_SECONDS,
      });
      if (result !== "OK") {
        throw new Error("payment_permit_not_stored");
      }
      return { token, expiresInSeconds: PERMIT_TTL_SECONDS };
    } catch {
      throw new Error("checkout_protection_unavailable");
    }
  }

  async consume(token: string): Promise<ConsumedPaymentPermit | null> {
    if (!token || token.length > 200) {
      return null;
    }

    try {
      const value = await this.redis.eval(CONSUME_SCRIPT, [this.key(token)], []);
      if (value === null) {
        return null;
      }
      const decoded = typeof value === "string" ? JSON.parse(value) : value;
      return readPaymentPermit(decoded);
    } catch {
      throw new Error("checkout_protection_unavailable");
    }
  }

  private key(token: string): string {
    return `rdk:checkout:payment-permit:${token}`;
  }
}

export function createPaymentPermitStore(): PaymentPermitStore {
  return new PaymentPermitStore(
    new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
  );
}
