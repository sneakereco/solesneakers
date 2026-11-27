import { CheckoutDependencyLeaseRepository } from "@/Modules/Checkout/Source/Features/Recovery/dependency-lease";
import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { env } from "@/config/env";
import {
  checkoutAdmissionBudgets,
  type CheckoutAdmissionBudgets,
} from "@/Modules/Checkout/Source/Features/Operations/admission";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import {
  coarseWindows,
  admitCheckout,
  financialAdmission,
  slidingWindowsScript,
  type AdmissionDecision,
  type AdmissionInput,
  type Window,
} from "@/Modules/Checkout/Source/Features/Operations/admission";

export type CheckoutAttemptIdentity = {
  clientIp: string;
  shopperBinding: string;
  eventId: string;
};
export type CheckoutAttemptDecision = AdmissionDecision;
type RedisEvalClient = {
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
};

export class CheckoutAttemptLimiter {
  constructor(
    private readonly redis: RedisEvalClient,
    private readonly budgets: CheckoutAdmissionBudgets | null = checkoutAdmissionBudgets,
    private readonly client?: Pick<AdminSupabaseClient, "rpc">,
  ) {}
  admit(input: AdmissionInput) {
    return admitCheckout(input, {
      budgets: this.budgets,
      consume: (w) => this.consume(w),
      financial: this.client ? (i) => financialAdmission(this.client!, i) : undefined,
    });
  }
  coarse(ip: string) {
    if (!ip || !this.budgets) throw Error("checkout_protection_unavailable");
    return this.consume(coarseWindows(ip, this.budgets));
  }
  check(identity: CheckoutAttemptIdentity) {
    return this.admit({
      kind: "new_prepare",
      shopperBinding: identity.shopperBinding,
      ip: identity.clientIp,
      eventId: identity.eventId,
    });
  }
  checkAddressValidation(identity: CheckoutAttemptIdentity) {
    if (!this.budgets) throw Error("checkout_protection_unavailable");
    return this.consume([
      {
        key: "address:" + identity.shopperBinding,
        limit: 20,
        windowMs: 1800000,
        member: randomUUID(),
      },
      ...coarseWindows(identity.clientIp, this.budgets),
    ]);
  }
  private async consume(windows: Window[]): Promise<AdmissionDecision> {
    try {
      const result = await this.redis.eval(
        slidingWindowsScript,
        windows.map((w) => "rdk:checkout:{admission}:" + w.key),
        windows.flatMap((w) => [String(w.windowMs), String(w.limit), w.member]),
      );
      if (
        !Array.isArray(result) ||
        result.length !== 2 ||
        ![0, 1].includes(result[0]) ||
        !Number.isSafeInteger(result[1]) ||
        (result[0] === 0 ? result[1] <= 0 : result[1] !== 0)
      )
        throw Error();
      return result[0] === 1
        ? { allowed: true, retryAfterSeconds: null }
        : { allowed: false, retryAfterSeconds: Math.ceil(result[1] / 1000) };
    } catch {
      throw Error("checkout_protection_unavailable");
    }
  }
}
export function createCheckoutAttemptLimiter(client?: Pick<AdminSupabaseClient, "rpc">) {
  return new CheckoutAttemptLimiter(
    new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }),
    checkoutAdmissionBudgets,
    client,
  );
}

export class CheckoutProviderCapacity {
  private readonly leases: CheckoutDependencyLeaseRepository;
  constructor(
    client: Pick<AdminSupabaseClient, "rpc">,
    private readonly budgets: CheckoutAdmissionBudgets | null,
  ) {
    this.leases = new CheckoutDependencyLeaseRepository(client, budgets);
  }
  async acquire(dependency: "square" | "shippo") {
    if (!this.budgets) throw Error("checkout_protection_unavailable");
    const started = performance.now();
    const token = await this.leases.acquireDependencyLease({
      dependency,
      limit: this.budgets.providers[dependency],
      leaseSeconds: 120,
    });
    if (!token) throw Error("checkout_provider_busy");
    // A lost release leaves an expiring slot. It cannot overwrite a completed provider result.
    const release = () =>
      this.leases.releaseDependencyLease(token).catch(() => undefined);
    const remaining = Math.floor(120000 - (performance.now() - started)) - 1000;
    if (remaining <= 0) {
      await release();
      throw Error("checkout_provider_lease_elapsed");
    }
    return { signal: AbortSignal.timeout(Math.min(10000, remaining)), release };
  }
  async run<T>(
    dependency: "square" | "shippo",
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const { signal, release } = await this.acquire(dependency);
    try {
      return await work(signal);
    } finally {
      await release();
    }
  }
}
