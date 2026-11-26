import type { SquareClient } from "square";
import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";
import { verifyPaymentInquiry, verifyRefundInquiry } from "@/lib/square/verified-inquiry";
import { CheckoutPaymentAttemptRepository } from "./attempt-repository";
import { FinancialProjectionRepository } from "./projection-repository";
import { squareEventReceipt, type SquareEventReceiptInput } from "./webhook-inbox";
import {
  recordSquarePaymentDetails,
  squarePaymentDetails,
} from "@/lib/square/payment-details";
import type { SquarePaymentEventResult } from "@/lib/square/payment-event";

type Identity = { merchantId: string; locationId: string };
type Effects = {
  syncShipping: (result: SquarePaymentEventResult) => Promise<unknown>;
  scheduleNotifications: (orderId: string) => void;
};
type ProofInput = { paymentId: string; squareOrderId?: string; localOrderId?: string };

export class SquareFinancialInquiry {
  constructor(
    private readonly db: AdminSupabaseClient,
    private readonly square: Pick<
      SquareClient,
      "orders" | "payments" | "locations" | "refunds" | "disputes"
    >,
    private readonly identity: Identity,
    private readonly effects: Effects,
  ) {}

  async processStoredSquareEvent(eventId: string): Promise<void> {
    try {
      const { data, error } = await this.db
        .from("square_webhook_events")
        .select(
          "square_event_id,event_type,payload_sha256,event_data,processed_at,recovery_receipt",
        )
        .eq("square_event_id", eventId)
        .single();
      if (error || !data.recovery_receipt) throw new Error("Missing stored receipt");
      if (data.processed_at) return;
      const receipt = squareEventReceipt.parse({
        eventId: data.square_event_id,
        kind: data.event_type,
        payloadHash: data.payload_sha256,
        payload: data.event_data,
      });
      if (
        receipt.payload.merchantId !== this.identity.merchantId ||
        receipt.payload.locationId !== this.identity.locationId
      )
        throw new Error("Foreign receipt");
      // Older refund receipts placed the return order in squareOrderId. The
      // exact authenticated payment supplies the original sale order.
      const lookup = receipt.payload.refundId
        ? { paymentId: receipt.payload.paymentId }
        : receipt.payload;
      await this.apply(lookup, receipt);
      if (!receipt.payload.disputeId) {
        const { error: markError } = await this.db
          .from("square_webhook_events")
          .update({ processed_at: new Date().toISOString() })
          .eq("square_event_id", eventId)
          .eq("recovery_receipt", true)
          .is("processed_at", null);
        if (markError) throw markError;
      }
    } catch {
      throw new Error("square_receipt_processing_pending");
    }
  }

  async reconcileOrder(orderId: string): Promise<"skipped" | "processed"> {
    try {
      const { data: o, error } = await this.db
        .from("orders")
        .select(
          "id,status,square_order_id,payment_transaction_id,checkout_attempt_guarded",
        )
        .eq("id", orderId)
        .single();
      if (error) throw error;
      if (!o.square_order_id || o.status !== "pending") return "skipped";
      let paymentId = o.payment_transaction_id;
      if (!paymentId && o.checkout_attempt_guarded) {
        const { order } = await this.square.orders.get({ orderId: o.square_order_id });
        if (
          order?.referenceId !== o.id ||
          order.id !== o.square_order_id ||
          order.locationId !== this.identity.locationId
        )
          throw new Error("Invalid order");
        const ids = [
          ...new Set(
            order.tenders?.map((t) => t.paymentId).filter((id): id is string => !!id),
          ),
        ];
        if (ids.length === 1) paymentId = ids[0];
      }
      if (!paymentId) return "skipped";
      await this.apply({
        paymentId,
        localOrderId: o.id,
        squareOrderId: o.square_order_id,
      });
      return "processed";
    } catch {
      throw new Error("square_payment_inquiry_pending");
    }
  }

  async reconcileVerifiedPayment(
    paymentId: string,
    squareOrderId: string,
  ): Promise<SquarePaymentEventResult> {
    try {
      return await this.apply({ paymentId, squareOrderId });
    } catch {
      throw new Error("square_payment_inquiry_pending");
    }
  }

  private async apply(input: ProofInput, receipt?: SquareEventReceiptInput) {
    const { payment } = await this.square.payments.get({ paymentId: input.paymentId });
    if (
      !payment?.id ||
      payment.id !== input.paymentId ||
      !payment.orderId ||
      (input.squareOrderId && input.squareOrderId !== payment.orderId)
    )
      throw new Error("Invalid payment");
    const squareOrderId = payment.orderId;
    const { order } = await this.square.orders.get({ orderId: squareOrderId });
    const { location } = await this.square.locations.get({
      locationId: this.identity.locationId,
    });
    const { data: local, error } = await this.db
      .from("orders")
      .select(
        "id,square_order_id,checkout_attempt_guarded,payment_transaction_id,fulfillment_status,user_id",
      )
      .eq("square_order_id", squareOrderId)
      .single();
    if (
      error ||
      !local ||
      !order ||
      !location ||
      (input.localOrderId && input.localOrderId !== local.id)
    )
      throw new Error("Missing payment binding");
    const attempts = new CheckoutPaymentAttemptRepository(this.db);
    const lookup = () =>
      this.db
        .from("checkout_payment_attempts")
        .select(
          "id,order_id,square_order_id,amount_cents,currency,method,provider_payment_id,dispatched_at",
        )
        .eq("order_id", local.id);
    if (
      local.checkout_attempt_guarded &&
      !z.uuid().safeParse(payment.referenceId).success
    )
      throw new Error("Missing attempt reference");
    const read = () =>
      local.checkout_attempt_guarded
        ? lookup().eq("id", payment.referenceId!).maybeSingle()
        : lookup().eq("provider_payment_id", payment.id!).maybeSingle();
    let attempt = await read();
    if (attempt.error) throw attempt.error;
    if (
      !attempt.data &&
      !local.checkout_attempt_guarded &&
      local.payment_transaction_id === payment.id &&
      order.referenceId === local.id &&
      location.merchantId === this.identity.merchantId &&
      location.id === this.identity.locationId &&
      payment.locationId === location.id &&
      order.locationId === location.id
    ) {
      // False-guard issuance creates only the original review row. Its database
      // identity is immutable, and this inquiry never submits a Square payment.
      const details = squarePaymentDetails(payment);
      await attempts.getOrCreateAttempt({
        orderId: local.id,
        method:
          details.payment_method === "afterpay"
            ? "afterpay"
            : details.payment_method === "cashAppPay"
              ? "cashAppPay"
              : "card",
        ownerBinding: local.user_id ? "account:" + local.user_id : "order:" + local.id,
      });
      attempt = await read();
    }
    if (attempt.error || !attempt.data) throw new Error("Missing exact attempt");
    const { fact, review, createdAt } = verifyPaymentInquiry({
      ...this.identity,
      merchantLocation: location,
      payment,
      order,
      local,
      attempt: attempt.data,
    });
    const status = z
      .enum(["APPROVED", "PENDING", "COMPLETED", "FAILED", "CANCELED"])
      .parse(fact.status);
    const state = (
      {
        APPROVED: "pending",
        PENDING: "pending",
        COMPLETED: "succeeded",
        FAILED: "declined",
        CANCELED: "canceled",
      } as const
    )[status];
    await attempts.recordAttemptOutcome({
      attemptId: attempt.data.id,
      providerPaymentId: payment.id,
      state,
      verifiedFacts: {
        kind: "square_payment",
        orderId: local.id,
        squareOrderId,
        paymentId: payment.id,
        amountCents: fact.expectedTotalCents,
        currency: "USD",
        status,
      },
    });
    const repo = new FinancialProjectionRepository(this.db, createdAt, review);
    const refundId = receipt?.payload.refundId;
    if (refundId) {
      const { refund } = await this.square.refunds.get({ refundId });
      const verified = verifyRefundInquiry(
        refund,
        refundId,
        fact,
        this.identity.locationId,
      );
      await new FinancialProjectionRepository(
        this.db,
        refund!.updatedAt!,
      ).applyFinancialFact(verified);
      const { data: stored, error: refundError } = await this.db
        .from("square_refunds")
        .select("checkout_status_conflict,amount_cents")
        .eq("square_refund_id", refundId)
        .eq("order_id", local.id)
        .eq("square_payment_id", payment.id)
        .single();
      if (refundError || !stored) throw new Error("Missing verified refund");
      if (stored.checkout_status_conflict) {
        // A fresh provider read can corroborate completed money. Uncertainty
        // leaves this receipt pending, and historical conflict remains visible.
        const { refund: refreshed } = await this.square.refunds.get({ refundId });
        const confirmed = verifyRefundInquiry(
          refreshed,
          refundId,
          fact,
          this.identity.locationId,
        );
        if (
          confirmed.status !== "COMPLETED" ||
          confirmed.amountCents !== stored.amount_cents
        )
          throw new Error("refund_refresh_required");
        await new FinancialProjectionRepository(
          this.db,
          refreshed!.updatedAt!,
        ).applyFinancialFact(confirmed);
      }
    }
    const snapshot = await repo.applyFinancialFact(fact);
    const details = squarePaymentDetails(payment);
    await recordSquarePaymentDetails(this.db, {
      squareOrderId,
      paymentId: payment.id,
      status,
      amountCents: fact.amountCents,
      currency: "USD",
      details: {
        source_type: details.source_type,
        payment_method: details.payment_method,
      },
    });
    if (status === "COMPLETED" && !refundId && !receipt?.payload.disputeId) {
      await this.effects.syncShipping({
        duplicate: false,
        fulfillmentAuthorized:
          snapshot.reviewReason === null && snapshot.financialState === "paid",
        orderId: local.id,
        paymentStatus: status,
        squareOrderId,
      });
      this.effects.scheduleNotifications(local.id);
    }
    const disputeId = receipt?.payload.disputeId;
    if (receipt && disputeId) {
      const { dispute: d } = await this.square.disputes.get({ disputeId });
      if (
        d?.id !== disputeId ||
        d.locationId !== this.identity.locationId ||
        d.disputedPayment?.paymentId !== payment.id ||
        d.amountMoney?.currency !== "USD" ||
        !d.updatedAt ||
        !d.state ||
        !d.reason
      )
        throw new Error("Invalid dispute");
      const { error: disputeError } = await this.db.rpc(
        "apply_checkout_dispute_receipt",
        {
          p_event_id: receipt.eventId,
          p_order_id: local.id,
          p_dispute: {
            id: disputeId,
            paymentId: payment.id,
            amountCents: Number(d.amountMoney.amount),
            currency: "USD",
            state: d.state,
            reason: d.reason,
            updatedAt: d.updatedAt,
            dueAt: d.dueAt ?? null,
          },
        },
      );
      if (disputeError) throw disputeError;
    }
    return {
      duplicate: false,
      fulfillmentAuthorized:
        snapshot.financialState === "paid" && snapshot.reviewReason === null,
      orderId: local.id,
      paymentStatus: status,
      squareOrderId,
    };
  }
}
