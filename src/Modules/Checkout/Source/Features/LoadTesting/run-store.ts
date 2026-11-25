import { Redis } from "@upstash/redis";
import type { LoadTestSettings } from "./settings";

export type RunRecord = {
  runId: string;
  phaseId: string;
  targetDigest: string;
  profile: string;
  providerMode: "simulated" | "sandbox";
  start: number;
  end: number;
  expiresAt: number;
  revoked: boolean;
};
export interface RunStore {
  get<T>(kind: string, id: string): Promise<T | null>;
  put(kind: string, id: string, value: unknown, ttlSeconds?: number): Promise<void>;
  remove(kind: string, id: string): Promise<void>;
  once(id: string): Promise<boolean>;
  mutate<T>(
    kind: string,
    id: string,
    initial: T,
    change: (value: T) => T,
    queue?: QueueEffect<T>,
  ): Promise<T>;
  queueItems<T>(kind: string, id: string, limit: number, offset?: number): Promise<T[]>;
  acknowledge(kind: string, id: string, value: unknown): Promise<void>;
}
export type QueueEffect<T> = { kind: string; id: string; value: (next: T) => unknown };
const COMPARE_SET = `local current = redis.call('GET', KEYS[1]); local revision = 0; if current then revision = cjson.decode(current).revision end; if revision ~= tonumber(ARGV[1]) then return 0 end; redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); if #KEYS > 1 then redis.call('RPUSH', KEYS[2], ARGV[4]); redis.call('EXPIRE', KEYS[2], ARGV[3]) end; return 1`;
class RedisRunStore implements RunStore {
  constructor(
    private redis: Redis,
    private prefix: string,
  ) {}
  private key(kind: string, id: string) {
    if (!/^[\w.:-]{1,250}$/.test(kind) || !/^[\w.@:-]{1,500}$/.test(id))
      throw new Error("Invalid load registry key");
    return `${this.prefix}:${kind}:${id}`;
  }
  async get<T>(kind: string, id: string): Promise<T | null> {
    const value = await this.redis.get<{ revision: number; data: T }>(this.key(kind, id));
    return value?.data ?? null;
  }
  async put(kind: string, id: string, value: unknown, ttlSeconds = 86400) {
    await this.redis.set(
      this.key(kind, id),
      { revision: 1, data: value },
      { ex: ttlSeconds },
    );
  }
  async remove(kind: string, id: string) {
    await this.redis.del(this.key(kind, id));
  }
  async once(id: string) {
    return (
      (await this.redis.set(
        this.key("nonce", id),
        { revision: 1, data: true },
        { nx: true, ex: 300 },
      )) === "OK"
    );
  }
  async mutate<T>(
    kind: string,
    id: string,
    initial: T,
    change: (value: T) => T,
    queue?: QueueEffect<T>,
  ): Promise<T> {
    const key = this.key(kind, id);
    for (let attempt = 0; attempt < 12; attempt++) {
      const old = await this.redis.get<{ revision: number; data: T }>(key);
      const next = change(old?.data ?? structuredClone(initial));
      const ok = await this.redis.eval(
        COMPARE_SET,
        queue ? [key, this.key(queue.kind, queue.id)] : [key],
        [
          String(old?.revision ?? 0),
          JSON.stringify({ revision: (old?.revision ?? 0) + 1, data: next }),
          "86400",
          ...(queue ? [JSON.stringify(queue.value(next))] : []),
        ],
      );
      if (ok === 1) return next;
    }
    throw new Error("Load registry contention limit");
  }
  async queueItems<T>(kind: string, id: string, limit: number, offset = 0): Promise<T[]> {
    return this.redis.lrange<T>(
      this.key(kind, id),
      offset,
      offset + Math.min(100, Math.max(1, limit)) - 1,
    );
  }
  async acknowledge(kind: string, id: string, value: unknown): Promise<void> {
    await this.redis.lrem(this.key(kind, id), 1, JSON.stringify(value));
  }
}
export function createLoadRunStore(settings: LoadTestSettings): RunStore {
  return new RedisRunStore(
    new Redis({ url: settings.target.resources.redis.url, token: settings.redisToken }),
    `soles:load:{${settings.target.expected.deploymentId}}`,
  );
}
