import { randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { env } from "@/config/env";

export type CheckoutAttemptIdentity = {
  tenantId: string;
  clientIp: string;
  userId: string | null;
  normalizedEmailHash: string;
  deviceSessionId: string;
};

export type CheckoutAttemptDecision = {
  allowed: boolean;
  retryAfterSeconds: number | null;
};

type RedisEvalClient = {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};

const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const HOURLY_WINDOW_MS = 60 * 60 * 1000;

const ATOMIC_SLIDING_WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local member = ARGV[2]
local retry_after = 0

for index, key in ipairs(KEYS) do
  local window = tonumber(ARGV[index * 2 + 1])
  local limit = tonumber(ARGV[index * 2 + 2])
  redis.call("ZREMRANGEBYSCORE", key, 0, now - window)
  local count = redis.call("ZCARD", key)
  if count >= limit then
    local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
    if oldest[2] then
      retry_after = math.max(retry_after, window - (now - tonumber(oldest[2])))
    else
      retry_after = math.max(retry_after, window)
    end
  end
end

if retry_after > 0 then
  return {0, retry_after}
end

for index, key in ipairs(KEYS) do
  local window = tonumber(ARGV[index * 2 + 1])
  redis.call("ZADD", key, now, member .. ":" .. index)
  redis.call("PEXPIRE", key, window)
end

return {1, 0}
`;

export class CheckoutAttemptLimiter {
  constructor(
    private readonly redis: RedisEvalClient,
    private readonly now: () => number = Date.now,
  ) {}

  async check(identity: CheckoutAttemptIdentity): Promise<CheckoutAttemptDecision> {
    const prefix = `rdk:checkout:tenant:${identity.tenantId}`;
    const keys = [`${prefix}:email:${identity.normalizedEmailHash}`];
    const limits = [5];

    if (identity.userId) {
      keys.push(`${prefix}:user:${identity.userId}`);
      limits.push(5);
    }

    keys.push(`${prefix}:device:${identity.deviceSessionId}`);
    limits.push(10);

    try {
      return await this.checkWindows(
        keys.map((key, index) => ({
          key,
          windowMs: DAILY_WINDOW_MS,
          limit: limits[index]!,
        })),
      );
    } catch {
      throw new Error("checkout_protection_unavailable");
    }
  }

  async checkPaymentAttempt(input: {
    tenantId: string;
    orderId: string;
    clientIp: string;
    deviceSessionId: string;
    normalizedEmailHash: string;
  }): Promise<CheckoutAttemptDecision> {
    const prefix = `rdk:checkout:tenant:${input.tenantId}:payment`;
    return this.checkWindows([
      {
        key: `${prefix}:order:${input.orderId}`,
        windowMs: THIRTY_MINUTES_MS,
        limit: 3,
      },
      { key: `${prefix}:ip:${input.clientIp}`, windowMs: HOURLY_WINDOW_MS, limit: 10 },
      {
        key: `${prefix}:device:${input.deviceSessionId}`,
        windowMs: HOURLY_WINDOW_MS,
        limit: 5,
      },
      {
        key: `${prefix}:email:${input.normalizedEmailHash}`,
        windowMs: HOURLY_WINDOW_MS,
        limit: 5,
      },
    ]);
  }

  async recordDecline(input: {
    tenantId: string;
    deviceSessionId: string;
  }): Promise<CheckoutAttemptDecision> {
    return this.checkWindows([
      {
        key: `rdk:checkout:tenant:${input.tenantId}:payment:decline:device:${input.deviceSessionId}`,
        windowMs: HOURLY_WINDOW_MS,
        limit: 5,
      },
    ]);
  }

  private async checkWindows(
    windows: Array<{ key: string; windowMs: number; limit: number }>,
  ): Promise<CheckoutAttemptDecision> {
    try {
      const result = await this.redis.eval(
        ATOMIC_SLIDING_WINDOW_SCRIPT,
        windows.map(({ key }) => key),
        [
          String(this.now()),
          randomUUID(),
          ...windows.flatMap(({ windowMs, limit }) => [String(windowMs), String(limit)]),
        ],
      );

      if (
        !Array.isArray(result) ||
        result.length < 2 ||
        typeof result[0] !== "number" ||
        typeof result[1] !== "number"
      ) {
        throw new Error("invalid_upstash_response");
      }

      return result[0] === 1
        ? { allowed: true, retryAfterSeconds: null }
        : {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil(result[1] / 1000)),
          };
    } catch {
      throw new Error("checkout_protection_unavailable");
    }
  }
}

export function createCheckoutAttemptLimiter(): CheckoutAttemptLimiter {
  const redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });

  return new CheckoutAttemptLimiter(redis);
}
