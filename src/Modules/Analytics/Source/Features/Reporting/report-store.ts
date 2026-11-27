import "server-only";
import { Redis } from "@upstash/redis";
import { env } from "@/config/env";

export interface ReportStore {
  read(key: string): Promise<string | null>;
  lock(key: string, owner: string): Promise<boolean>;
  finish(key: string, owner: string, value: string | null): Promise<void>;
  admit(project: string, id: string): Promise<"ok" | "busy" | "limited">;
  release(project: string, id: string): Promise<void>;
  cooldown(project: string, permit: string, milliseconds: number): Promise<void>;
}

type Cooldown = {
  until: number;
  permit: string;
  confirmed: boolean;
  retryAt: number;
  writing?: Promise<void>;
};
type LocalProject = { users: number; cooldown?: Cooldown };
const localProjects = new Map<string, LocalProject>();
/** Reserve an entry before issuing work. A full registry refuses additional projects
 * until an entry is unused and its Retry-After has elapsed. */
export function reserveReportProject(key: string, store: ReportStore, deadline: number) {
  const now = performance.now();
  for (const [k, p] of localProjects)
    if (p.users === 0 && (p.cooldown?.until ?? 0) <= now) localProjects.delete(k);
  const project = localProjects.get(key) ?? ({ users: 0 } as LocalProject);
  if (!localProjects.has(key) && localProjects.size >= 32) return null;
  project.users++;
  localProjects.set(key, project);

  function persist(block: Cooldown, attempts: number): Promise<void> {
    if (block.writing) return block.writing;
    if (block.confirmed || performance.now() < block.retryAt) return Promise.resolve();
    block.writing = (async () => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const at = performance.now(),
          remaining = Math.ceil(block.until - at);
        // Each Upstash operation is bounded to 1 second.
        if (remaining <= 0 || deadline - at < 1000) break;
        try {
          await store.cooldown(key, block.permit, remaining);
          block.confirmed = true;
          break;
        } catch {
          // Unknown commit. Repeating the atomic max-TTL/exact-permit operation is safe.
        }
      }
    })().finally(() => {
      block.writing = undefined;
      block.retryAt = performance.now() + 1000;
    });
    return block.writing;
  }
  return {
    close() {
      project.users--;
    },
    isBlocked() {
      return (project.cooldown?.until ?? 0) > performance.now();
    },
    async blocked() {
      const block = project.cooldown;
      if (!block || block.until <= performance.now()) return false;
      await persist(block, 1);
      return true;
    },
    rateLimited(permit: string, delay: number) {
      const until = Math.max(project.cooldown?.until ?? 0, performance.now() + delay);
      const block: Cooldown = { permit, until, confirmed: false, retryAt: 0 };
      project.cooldown = block;
      return persist(block, 2);
    },
  };
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
 redis.call('ZREM',KEYS[2],ARGV[2])
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
    cooldown: async (project, permit, ms) => {
      await redis.eval(
        extendCooldown,
        [project + ":cooldown", project + ":slots"],
        [ms, permit],
      );
    },
  };
}
