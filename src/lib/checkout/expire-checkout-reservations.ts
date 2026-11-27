import { createHash } from "node:crypto";
import { z } from "zod";
import { expireCheckout } from "@/Modules/Checkout/Source/Features/Recovery/expiry-operation";
import { CheckoutRecoveryRepository } from "@/Modules/Checkout/Source/Features/Recovery/recovery-repository";
import { CheckoutDependencyLeaseRepository } from "@/Modules/Checkout/Source/Features/Recovery/dependency-lease";
import {
  deadlineFetch,
  type RecoveryWorkerDependencies,
} from "@/Modules/Checkout/Source/Features/Recovery/recovery-worker";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { createSquareFinancialInquiry } from "@/lib/square/financial-inquiry-dependencies";
import { createSquareClient } from "@/lib/square/client";
import { getSquareConfig, getSquareMerchantId } from "@/lib/square/config";
import { SquareCheckoutOrdersGateway } from "@/lib/square/checkout-orders";

const expiryMark = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unchanged") }),
  z.object({ kind: z.literal("review") }),
  z.object({
    kind: z.literal("inquire"),
    squareOrderId: z.string().nullable(),
    unknownKeys: z.array(z.guid()),
  }),
]);
export function createCheckoutRecoveryDependencies(
  db: AdminSupabaseClient,
): RecoveryWorkerDependencies {
  const jobs = new CheckoutRecoveryRepository(db),
    leases = new CheckoutDependencyLeaseRepository(db);
  return {
    claimRecovery: (i) => jobs.claimRecovery(i),
    finishRecovery: (i) => jobs.finishRecovery(i),
    acquireDependencyLease: (i) => leases.acquireDependencyLease(i),
    releaseDependencyLease: (t) => leases.releaseDependencyLease(t),
    async sweep() {
      const { error } = await db.rpc("sweep_checkout_recovery", { p_limit: 50 });
      if (error) throw error;
    },
    async oldestDueMs() {
      const { data, error } = await db.rpc("oldest_checkout_recovery_due_ms");
      if (error) throw error;
      return z.number().int().nonnegative().parse(data);
    },
    async process(job, signal) {
      const inquiry = () => createSquareFinancialInquiry(db, signal);
      if (job.kind === "square_event") {
        const { data, error } = await db
          .from("square_webhook_events")
          .select("processed_at,recovery_receipt")
          .eq("square_event_id", job.eventId!)
          .single();
        if (error) throw error;
        if (data.processed_at) return "done";
        if (!data.recovery_receipt) return "retry";
        await inquiry().processStoredSquareEvent(job.eventId!);
        return "done";
      }
      const orderId = job.orderId!;
      if (job.kind === "reconcile_payment") {
        const { data, error } = await db
          .from("checkout_recovery_jobs")
          .select("unique_key")
          .eq("id", job.id)
          .single();
        if (error) throw error;
        if (data.unique_key === "legacy_payment_order:" + orderId) return "review";
        const match = /^payment_attempt:(.+)$/.exec(data.unique_key);
        if (!match || !z.guid().safeParse(match[1]).success) return "review";
        return inquiry().recoverAttempt(orderId, match[1]);
      }
      const square = () =>
        createSquareClient({ maxRetries: 0, fetch: deadlineFetch(signal) });
      const result = await expireCheckout(orderId, {
        async mark(id) {
          const { data, error } = await db.rpc("mark_checkout_expiry", {
            p_order_id: id,
          });
          if (error) throw error;
          return expiryMark.parse(data);
        },
        async inquire(id) {
          const { data, error } = await db
            .from("checkout_payment_attempts")
            .select("id")
            .eq("order_id", id)
            .not("dispatched_at", "is", null)
            .order("sequence");
          if (error) throw error;
          for (const a of data) {
            signal.throwIfAborted();
            await inquiry().recoverAttempt(id, a.id, true);
          }
        },
        async cancelByKey(key) {
          await square().payments.cancelByIdempotencyKey({ idempotencyKey: key });
        },
        async cancelOrder(id, localId) {
          const client = square(),
            locationId = getSquareConfig().locationId;
          const { location } = await client.locations.get({ locationId });
          if (
            location?.id !== locationId ||
            location.merchantId !== getSquareMerchantId()
          )
            throw Error("unverified_cancel_merchant");
          const read = async () => {
            const { order } = await client.orders.get({ orderId: id });
            if (
              order?.id !== id ||
              order.referenceId !== localId ||
              order.locationId !== locationId
            )
              throw Error("unverified_cancel_order");
            return order;
          };
          const order = await read();
          const canceledProof = async (observed: typeof order) => {
            if (observed.state !== "CANCELED") return null;
            if (!observed.tenders?.length) return id;
            const { data, error } = await db
              .from("checkout_financial_facts")
              .select("payment_id,status")
              .eq("order_id", localId)
              .eq("kind", "payment");
            if (error) throw error;
            const negative = new Set(
              data
                .filter((f) => ["CANCELED", "FAILED"].includes(f.status))
                .map((f) => f.payment_id),
            );
            return observed.tenders.every((t) => t.paymentId && negative.has(t.paymentId))
              ? id
              : null;
          };
          if (order.state === "CANCELED") return canceledProof(order);
          if (
            order.state !== "OPEN" ||
            !Number.isSafeInteger(order.version) ||
            order.tenders?.length
          )
            return null;
          const key = createHash("sha256")
            .update(id + "|" + order.version)
            .digest("hex")
            .slice(0, 28);
          await new SquareCheckoutOrdersGateway(client.orders, locationId).cancel(
            id,
            order.version!,
            key,
          );
          return canceledProof(await read());
        },
        async finish(id, confirmed) {
          const { data, error } = await db.rpc("finish_checkout_expiry", {
            p_order_id: id,
            ...(confirmed ? { p_canceled_square_order_id: confirmed } : {}),
          });
          if (error) throw error;
          return z.enum(["released", "review", "reconcile", "unchanged"]).parse(data);
        },
      });
      return result === "reconcile" ? "retry" : result === "review" ? "review" : "done";
    },
  };
}
