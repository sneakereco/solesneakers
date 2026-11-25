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
  constructor(private readonly client: Pick<AdminSupabaseClient, "rpc">) {}

  async acquireDependencyLease(
    input: AcquireDependencyLeaseInput,
  ): Promise<string | null> {
    const { data, error } = await this.client.rpc("acquire_checkout_dependency_lease", {
      p_dependency: input.dependency,
      p_limit: input.limit,
      p_lease_seconds: input.leaseSeconds,
    });
    if (error) throw error;
    const token = leaseTokenSchema.safeParse(data);
    if (!token.success) throw new Error("Invalid checkout dependency lease");
    return token.data;
  }

  async releaseDependencyLease(token: string): Promise<void> {
    const { error } = await this.client.rpc("release_checkout_dependency_lease", {
      p_token: token,
    });
    if (error) throw error;
  }
}
