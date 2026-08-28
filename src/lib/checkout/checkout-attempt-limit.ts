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

const ATOMIC_SLIDING_WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local member = ARGV[3]
local retry_after = 0

for index, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[index + 3])
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
      const result = await this.redis.eval(ATOMIC_SLIDING_WINDOW_SCRIPT, keys, [
        String(this.now()),
        String(DAILY_WINDOW_MS),
        randomUUID(),
        ...limits.map(String),
      ]);

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
