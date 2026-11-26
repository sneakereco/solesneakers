import { after } from "next/server";
import { CheckoutDependencyLeaseRepository } from "@/Modules/Checkout/Source/Features/Recovery/dependency-lease";
import { SquareFinancialInquiry } from "@/Modules/Checkout/Source/Features/Payments/square-financial-inquiry";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { scheduleCheckoutNotifications } from "@/lib/checkout/checkout-notification-scheduler";
import {
  createSquareShippingSyncDependencies,
  synchronizeSquareShippingAddress,
} from "./shipping-address-sync";
import { getSquareConfig, getSquareMerchantId } from "./config";
import { createSquareClient } from "./client";

export function createSquareFinancialInquiry(db: AdminSupabaseClient) {
  const square = createSquareClient({ maxRetries: 0 });
  return new SquareFinancialInquiry(
    db,
    square,
    { merchantId: getSquareMerchantId(), locationId: getSquareConfig().locationId },
    {
      syncShipping: (result) =>
        synchronizeSquareShippingAddress(
          result,
          createSquareShippingSyncDependencies(db, square),
        ),
      scheduleNotifications: scheduleCheckoutNotifications,
    },
  );
}

// A prompt can process only this newly stored event. Durable work remains for
// the existing recovery queue after platform interruption or dependency failure.
export function promptSquareReceipt(db: AdminSupabaseClient, eventId: string) {
  try {
    after(async () => {
      const leases = new CheckoutDependencyLeaseRepository(db);
      let token: string | null = null;
      try {
        token = await leases.acquireDependencyLease({
          dependency: "square",
          limit: 1,
          leaseSeconds: 120,
        });
        if (token)
          await createSquareFinancialInquiry(db).processStoredSquareEvent(eventId);
      } catch {
        /* The durable obligation is still pending. */
      } finally {
        if (token) await leases.releaseDependencyLease(token).catch(() => undefined);
      }
    });
  } catch {
    /* Some request runtimes do not support after(). */
  }
}
