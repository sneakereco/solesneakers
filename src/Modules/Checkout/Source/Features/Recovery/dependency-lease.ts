import { log } from "@/lib/utils/log";
import {
  checkoutAdmissionBudgets,
  type CheckoutAdmissionBudgets,
} from "../Operations/admission";
import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";

export type CheckoutDependency = "square" | "shippo" | "smtp";

export type AcquireDependencyLeaseInput = {
  dependency: CheckoutDependency;
  limit: number;
  leaseSeconds: number;
};

const leaseTokenSchema = z.guid().nullable();

export class CheckoutDependencyLeaseRepository {
  constructor(
    private readonly client: Pick<AdminSupabaseClient, "rpc">,
    private readonly budgets: CheckoutAdmissionBudgets | null = checkoutAdmissionBudgets,
  ) {}

  async acquireDependencyLease(
    input: AcquireDependencyLeaseInput,
  ): Promise<string | null> {
    const { data, error } = await this.client.rpc("acquire_checkout_dependency_lease", {
      p_dependency: input.dependency,
      p_limit:
        input.dependency !== "smtp" && this.budgets
          ? Math.min(input.limit, this.budgets.providers[input.dependency])
          : input.limit,
      p_lease_seconds: input.leaseSeconds,
    });
    if (error) {
      log({
        level: "warn",
        layer: "repository",
        message: "checkout_lease",
        operation: input.dependency,
        outcome: "unavailable",
      });
      throw error;
    }
    const token = leaseTokenSchema.safeParse(data);
    if (!token.success) throw new Error("Invalid checkout dependency lease");
    log({
      level: "info",
      layer: "repository",
      message: "checkout_lease",
      operation: input.dependency,
      outcome: token.data ? "acquired" : "busy",
    });
    return token.data;
  }

  async releaseDependencyLease(token: string): Promise<void> {
    const { error } = await this.client.rpc("release_checkout_dependency_lease", {
      p_token: token,
    });
    if (error) {
      log({
        level: "warn",
        layer: "repository",
        message: "checkout_lease",
        outcome: "release_failed",
      });
      throw error;
    }
  }
}
