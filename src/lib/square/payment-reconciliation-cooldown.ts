import { Redis } from "@upstash/redis";

import { env } from "@/config/env";

type RedisSetClient = {
  set(
    key: string,
    value: string,
    options: { nx: true; ex: number },
  ): Promise<string | null>;
};

export class SquarePaymentReconciliationCooldown {
  constructor(
    private readonly redis: RedisSetClient,
    private readonly ttlSeconds = 10,
  ) {}

  async acquire(orderId: string): Promise<boolean> {
    const result = await this.redis.set(`rdk:square:reconcile:order:${orderId}`, "1", {
      nx: true,
      ex: this.ttlSeconds,
    });
    return result === "OK";
  }
}

export function createSquarePaymentReconciliationCooldown() {
  return new SquarePaymentReconciliationCooldown(
    new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
  );
}
