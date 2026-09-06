import { randomUUID } from "node:crypto";

import { z } from "zod";
import { Redis } from "@upstash/redis";

import { env } from "@/config/env";

export type PaymentMethod = "card" | "afterpay" | "applePay" | "googlePay" | "cashAppPay";

export type PaymentPermitPayload = {
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

const permitSchema = z
  .object({
    tenantId: z.string().min(1),
    orderId: z.string().min(1),
    cartHash: z.string().min(1),
    totalCents: z.number().int().positive(),
    method: z.enum(["card", "afterpay", "applePay", "googlePay", "cashAppPay"]),
    deviceSessionId: z.string().min(1),
    normalizedEmailHash: z.string().min(1),
    squareIdempotencyKey: z.string().uuid(),
  })
  .strict();

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
    const parsed = permitSchema.parse(payload);
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

  async consume(token: string): Promise<PaymentPermitPayload | null> {
    if (!token || token.length > 200) {
      return null;
    }

    try {
      const value = await this.redis.eval(CONSUME_SCRIPT, [this.key(token)], []);
      if (value === null) {
        return null;
      }
      if (typeof value !== "string") {
        throw new Error("payment_permit_invalid");
      }
      const parsed = permitSchema.safeParse(JSON.parse(value));
      if (!parsed.success) {
        throw new Error("payment_permit_invalid");
      }
      return parsed.data;
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
