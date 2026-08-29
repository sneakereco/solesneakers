import { z } from "zod";

import type { TypedSupabaseClient } from "@/lib/supabase/server";

export type CheckoutSettings = {
  flatShippingCents: number;
};

const checkoutSettingsRowSchema = z.object({
  flat_shipping_cents: z.number().int().nonnegative(),
});

export class CheckoutSettingsRepository {
  constructor(private readonly supabase: TypedSupabaseClient) {}

  async getByTenant(tenantId: string): Promise<CheckoutSettings | null> {
    const { data, error } = await this.supabase
      .from("tenant_checkout_settings")
      .select("flat_shipping_cents")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      return null;
    }

    const parsed = checkoutSettingsRowSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error("checkout_settings_invalid");
    }
    return { flatShippingCents: parsed.data.flat_shipping_cents };
  }

  async upsert(tenantId: string, flatShippingCents: number): Promise<CheckoutSettings> {
    if (!Number.isSafeInteger(flatShippingCents) || flatShippingCents < 0) {
      throw new Error("checkout_settings_invalid_flat_shipping");
    }

    const { data, error } = await this.supabase
      .from("tenant_checkout_settings")
      .upsert(
        {
          tenant_id: tenantId,
          flat_shipping_cents: flatShippingCents,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      )
      .select("flat_shipping_cents")
      .single();

    if (error) {
      throw error;
    }

    const parsed = checkoutSettingsRowSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error("checkout_settings_invalid");
    }
    return { flatShippingCents: parsed.data.flat_shipping_cents };
  }
}
