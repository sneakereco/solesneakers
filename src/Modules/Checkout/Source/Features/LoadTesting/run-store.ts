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
  purgeRun(runId: string): Promise<number>;
}
export type QueueEffect<T> = { kind: string; id: string; value: (next: T) => unknown };
const COMPARE_SET = `local current = redis.call('GET', KEYS[1]); local revision = 0; if current then revision = cjson.decode(current).revision end; if revision ~= tonumber(ARGV[1]) then return 0 end; redis.call('SET', KEYS[1], ARGV[2]); if KEYS[2] ~= KEYS[1] then redis.call('SADD', KEYS[2], KEYS[1]) end; if #KEYS == 3 then redis.call('RPUSH', KEYS[3], ARGV[3]); redis.call('SADD',KEYS[2],KEYS[3]) end; return 1`;
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
  private owner(kind: string, id: string, value: unknown): string | null {
    if (kind === "lock") return null;
    const runId =
      value && typeof value === "object" && "runId" in value
        ? (value as { runId: string }).runId
        : ["fault"].includes(kind)
          ? id
          : null;
    return runId && /^[a-f0-9-]{36}$/.test(runId) ? runId : null;
  }
  async put(kind: string, id: string, value: unknown, ttlSeconds?: number) {
    const key = this.key(kind, id),
      owner = this.owner(kind, id, value),
      tx = this.redis.multi();
    if (ttlSeconds) tx.set(key, { revision: 1, data: value }, { ex: ttlSeconds });
    else tx.set(key, { revision: 1, data: value });
    if (owner) tx.sadd(this.key("keys", owner), key);
    await tx.exec();
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
      const owner = this.owner(kind, id, next),
        index = owner ? this.key("keys", owner) : key;
      const ok = await this.redis.eval(
        COMPARE_SET,
        queue ? [key, index, this.key(queue.kind, queue.id)] : [key, index],
        [
          String(old?.revision ?? 0),
          JSON.stringify({ revision: (old?.revision ?? 0) + 1, data: next }),
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
  async purgeRun(runId: string) {
    const index = this.key("keys", runId);
    let removed = 0;
    for (let batch = 0; batch < 10000; batch++) {
      const keys = (await this.redis.srandmember<string[]>(index, 100)) ?? [];
      if (!keys.length) {
        await this.redis.del(index);
        return removed;
      }
      if (keys.some((key) => !key.startsWith(this.prefix + ":")))
        throw Error("Registry ownership index invalid");
      await this.redis.eval(
        `for i=2,#KEYS do redis.call('DEL',KEYS[i]);redis.call('SREM',KEYS[1],KEYS[i]) end;return 1`,
        [index, ...keys],
        [],
      );
      removed += keys.length;
    }
    throw Error("Cleanup index exceeded budget");
  }
}
export function createLoadRunStore(settings: LoadTestSettings): RunStore {
  return new RedisRunStore(
    new Redis({ url: settings.target.resources.redis.url, token: settings.redisToken }),
    `soles:load:{${settings.target.expected.deploymentId}}`,
  );
}

