import {
  deadlineFetch,
  withDependency,
} from "@/Modules/Checkout/Source/Features/Recovery/recovery-worker";
import { after } from "next/server";
import { scheduleAnalyticsDrain } from "@/Modules/Analytics/Source/Features/EventDelivery/delivery-runtime";
import { CheckoutDependencyLeaseRepository } from "@/Modules/Checkout/Source/Features/Recovery/dependency-lease";
import { SquareFinancialInquiry } from "@/Modules/Checkout/Source/Features/Payments/square-financial-inquiry";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { scheduleCheckoutNotifications } from "@/lib/checkout/checkout-notification-scheduler";
import { log, logError } from "@/lib/utils/log";
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

// Dispatch already committed a durable recovery job. Prompt the same verified
// inquiry after the response so an accepted payment need not wait for cron.
export function promptSquareAttempt(
  db: AdminSupabaseClient,
  orderId: string,
  attemptId: string,
): void {
  const reportFailure = (error: unknown) =>
    logError(error, {
      layer: "job",
      route: "/api/checkout/pay",
      orderId,
      attemptId,
      event: "square_payment_reconciliation_failed",
    });
  try {
    after(async () => {
      try {
        const result = await withDependency(
          new CheckoutDependencyLeaseRepository(db),
          "square",
          Date.now() + 10000,
          (signal) =>
            createSquareFinancialInquiry(db, signal).recoverAttempt(orderId, attemptId),
        );
        log({
          level: result?.value === "done" ? "info" : "warn",
          layer: "job",
          message: "checkout_worker",
          route: "/api/checkout/pay",
          operation: "recovery",
          outcome: result?.value ?? "retry",
          orderId,
          attemptId,
        });
        if (result?.value === "done") scheduleAnalyticsDrain();
      } catch (error) {
        reportFailure(error);
      }
    });
  } catch (error) {
    reportFailure(error);
  }
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
        scheduleAnalyticsDrain();
      } catch {
        /* Durable receipt remains pending. */
      }
    });
  } catch {
    /* Some request runtimes do not support after(). */
  }
}
