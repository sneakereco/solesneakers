import {
  deadlineFetch,
  withDependency,
} from "@/Modules/Checkout/Source/Features/Recovery/recovery-worker";
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

export function createSquareFinancialInquiry(
  db: AdminSupabaseClient,
  signal?: AbortSignal,
) {
  const square = createSquareClient({
    maxRetries: 0,
    fetch: signal ? deadlineFetch(signal) : undefined,
  });
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
    !signal,
  );
}

// A prompt can process only this newly stored event. Durable work remains for
// the existing recovery queue after platform interruption or dependency failure.
export function promptSquareReceipt(db: AdminSupabaseClient, eventId: string) {
  try {
    after(async () => {
      const leases = new CheckoutDependencyLeaseRepository(db);
      try {
        await withDependency(leases, "square", Date.now() + 10000, (signal) =>
          createSquareFinancialInquiry(db, signal).processStoredSquareEvent(eventId),
        );
      } catch {
        /* Durable receipt remains pending. */
      }
    });
  } catch {
    /* Some request runtimes do not support after(). */
  }
}
