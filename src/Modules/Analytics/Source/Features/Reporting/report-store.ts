import "server-only";
import { Redis } from "@upstash/redis";
import { env } from "@/config/env";

export interface ReportStore {
  read(key: string): Promise<string | null>;
  lock(key: string, owner: string): Promise<boolean>;
  finish(key: string, owner: string, value: string | null): Promise<void>;
  admit(project: string, id: string): Promise<"ok" | "busy" | "limited">;
  release(project: string, id: string): Promise<void>;
  cooldown(project: string, milliseconds: number): Promise<void>;
}

// Each result and owner lock share a Redis hash slot. A late owner cannot
// replace a newer result or release another instance's lease.
const publish = `
 if redis.call('GET',KEYS[2]) ~= ARGV[1] then return 0 end
 if ARGV[2] ~= '' then redis.call('SET',KEYS[1],ARGV[2],'EX',900) end
 return redis.call('DEL',KEYS[2])`;

// Slot leases survive a lost worker only until its bounded HTTP call must end.
// The rolling window is counted per admitted Endpoint, across all report routes.
const admit = `
 if redis.call('EXISTS',KEYS[3])==1 then return 'limited' end
 local t=redis.call('TIME')
 local now=t[1]*1000+math.floor(t[2]/1000)
 redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',now-3600000)
 if redis.call('ZCARD',KEYS[2])>=900 or redis.call('ZCOUNT',KEYS[2],'('..(now-60000),'+inf')>=90 then return 'limited' end
 redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
 if redis.call('ZCARD',KEYS[1])>=2 then return 'busy' end
 redis.call('ZADD',KEYS[1],now+12000,ARGV[1])
 redis.call('PEXPIRE',KEYS[1],12000)
 redis.call('ZADD',KEYS[2],now,ARGV[1])
 redis.call('PEXPIRE',KEYS[2],3600000)
 return 'ok'`;
const extendCooldown = `
 if redis.call('PTTL',KEYS[1])<tonumber(ARGV[1]) then redis.call('SET',KEYS[1],'1','PX',ARGV[1]) end
 return 1`;

let client: Redis | undefined;
export function createReportStore(): ReportStore {
  const redis = (client ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    retry: false,
    signal: () => AbortSignal.timeout(1000),
    cache: "no-store",
    automaticDeserialization: false,
    enableAutoPipelining: false,
  }));
  return {
    read: (key) => redis.get<string>(key),
    lock: async (key, owner) =>
      (await redis.set(key + ":owner", owner, { nx: true, px: 25000 })) === "OK",
    finish: async (key, owner, value) => {
      await redis.eval(publish, [key, key + ":owner"], [owner, value ?? ""]);
    },
    admit: (project, id) =>
      redis.eval(
        admit,
        [project + ":slots", project + ":calls", project + ":cooldown"],
        [id],
      ),
    release: async (project, id) => {
      await redis.zrem(project + ":slots", id);
    },
    cooldown: async (project, ms) => {
      await redis.eval(extendCooldown, [project + ":cooldown"], [ms]);
    },
  };
}
