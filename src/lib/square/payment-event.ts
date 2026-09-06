import { createHash } from "node:crypto";

import { z } from "zod";

import type { TypedSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/db/database.types";

const moneySchema = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.string().length(3),
});

const paymentEventSchema = z.object({
  merchant_id: z.string().min(1),
  type: z.enum(["payment.created", "payment.updated"]),
  event_id: z.string().min(1),
  created_at: z.string().datetime(),
  data: z.object({
    type: z.literal("payment"),
    id: z.string().min(1),
    object: z.object({
      payment: z.object({
        id: z.string().min(1),
        order_id: z.string().min(1),
        location_id: z.string().min(1),
        created_at: z.string().datetime(),
        status: z.string().min(1),
        amount_money: moneySchema,
        risk_evaluation: z.object({ risk_level: z.string().min(1) }).optional(),
      }),
    }),
  }),
});

const refundEventSchema = z.object({
  merchant_id: z.string().min(1),
  type: z.enum(["refund.created", "refund.updated"]),
  event_id: z.string().min(1),
  created_at: z.string().datetime(),
  data: z.object({
    type: z.literal("refund"),
    id: z.string().min(1),
    object: z.object({
      refund: z.object({
        id: z.string().min(1),
        status: z.string().min(1),
        location_id: z.string().min(1),
        payment_id: z.string().min(1),
        amount_money: moneySchema,
        reason: z.string().nullable().optional(),
      }),
    }),
  }),
});

const disputeEventSchema = z.object({
  merchant_id: z.string().min(1),
  location_id: z.string().min(1),
  type: z.enum(["dispute.created", "dispute.state.updated"]),
  event_id: z.string().min(1),
  created_at: z.string().datetime(),
  data: z.object({
    type: z.literal("dispute"),
    id: z.string().min(1),
    object: z.object({
      dispute: z.object({
        id: z.string().min(1),
        state: z.string().min(1),
        reason: z.string().min(1),
        due_at: z.string().datetime().nullable().optional(),
        amount_money: moneySchema,
        disputed_payment: z.object({ payment_id: z.string().min(1) }),
      }),
    }),
  }),
});

const processResultSchema = z.object({
  duplicate: z.boolean(),
  fulfillment_authorized: z.boolean(),
  order_id: z.string().min(1).optional(),
});

export type SquarePaymentEventResult =
  | { ignored: true; reason: "location_mismatch" }
  | {
      duplicate: boolean;
      fulfillmentAuthorized: boolean;
      orderId: string | null;
      paymentStatus?: string;
      squareOrderId?: string;
    };

export type SquarePaymentSnapshot = {
  eventId: string;
  eventType: string;
  merchantId: string;
  locationId: string;
  createdAt: string;
  paymentId: string;
  squareOrderId: string;
  paymentStatus: string;
  amountCents: number;
  currency: string;
  riskLevel: string | null;
};

export class SquarePaymentEventProcessor {
  constructor(
    private readonly supabase: TypedSupabaseClient,
    private readonly expectedLocationId: string,
    private readonly verifyPaymentOrder: (
      payment: SquarePaymentSnapshot,
    ) => Promise<void>,
  ) {}

  async process(rawBody: string): Promise<SquarePaymentEventResult> {
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new Error("square_webhook_invalid_event");
    }

    const payloadHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
    const payment = paymentEventSchema.safeParse(event);
    if (payment.success) {
      return this.processPayment(payment.data, payloadHash);
    }

    const refund = refundEventSchema.safeParse(event);
    if (refund.success) {
      return this.processRefund(refund.data, payloadHash);
    }

    const dispute = disputeEventSchema.safeParse(event);
    if (dispute.success) {
      return this.processDispute(dispute.data, payloadHash);
    }

    throw new Error("square_webhook_invalid_event");
  }

  private async processPayment(
    event: z.infer<typeof paymentEventSchema>,
    payloadHash: string,
  ): Promise<SquarePaymentEventResult> {
    const payment = event.data.object.payment;
    if (payment.location_id !== this.expectedLocationId) {
      return { ignored: true, reason: "location_mismatch" };
    }
    return this.processPaymentSnapshot(
      {
        eventId: event.event_id,
        eventType: event.type,
        merchantId: event.merchant_id,
        locationId: payment.location_id,
        createdAt: payment.created_at,
        paymentId: payment.id,
        squareOrderId: payment.order_id,
        paymentStatus: payment.status,
        amountCents: payment.amount_money.amount,
        currency: payment.amount_money.currency,
        riskLevel: payment.risk_evaluation?.risk_level ?? null,
      },
      payloadHash,
    );
  }

  async processPaymentSnapshot(
    payment: SquarePaymentSnapshot,
    payloadHash = createHash("sha256")
      .update(JSON.stringify(payment), "utf8")
      .digest("hex"),
  ): Promise<SquarePaymentEventResult> {
    if (payment.locationId !== this.expectedLocationId) {
      return { ignored: true, reason: "location_mismatch" };
    }
    if (payment.paymentStatus === "COMPLETED") {
      await this.verifyPaymentOrder(payment);
    }

    const result = await this.call("process_square_payment_event", {
      p_square_event_id: payment.eventId,
      p_event_type: payment.eventType,
      p_merchant_id: payment.merchantId,
      p_location_id: payment.locationId,
      p_square_created_at: payment.createdAt,
      p_payload_sha256: payloadHash,
      p_event_data: {
        amountCents: payment.amountCents,
        currency: payment.currency,
        paymentId: payment.paymentId,
        paymentStatus: payment.paymentStatus,
        riskLevel: payment.riskLevel,
        squareOrderId: payment.squareOrderId,
      },
      p_square_order_id: payment.squareOrderId,
      p_square_payment_id: payment.paymentId,
      p_payment_status: payment.paymentStatus,
      p_amount_cents: payment.amountCents,
      p_currency: payment.currency,
      p_risk_level: payment.riskLevel,
    });
    return {
      ...result,
      paymentStatus: payment.paymentStatus,
      squareOrderId: payment.squareOrderId,
    };
  }

  private async processRefund(
    event: z.infer<typeof refundEventSchema>,
    payloadHash: string,
  ): Promise<SquarePaymentEventResult> {
    const refund = event.data.object.refund;
    if (refund.location_id !== this.expectedLocationId) {
      return { ignored: true, reason: "location_mismatch" };
    }
    return this.call("process_square_refund_event", {
      p_square_event_id: event.event_id,
      p_event_type: event.type,
      p_merchant_id: event.merchant_id,
      p_location_id: refund.location_id,
      p_square_created_at: event.created_at,
      p_payload_sha256: payloadHash,
      p_event_data: {
        amountCents: refund.amount_money.amount,
        currency: refund.amount_money.currency,
        paymentId: refund.payment_id,
        reason: refund.reason ?? null,
        refundId: refund.id,
        refundStatus: refund.status,
      },
      p_square_payment_id: refund.payment_id,
      p_square_refund_id: refund.id,
      p_refund_status: refund.status,
      p_amount_cents: refund.amount_money.amount,
      p_currency: refund.amount_money.currency,
    });
  }

  private async processDispute(
    event: z.infer<typeof disputeEventSchema>,
    payloadHash: string,
  ): Promise<SquarePaymentEventResult> {
    if (event.location_id !== this.expectedLocationId) {
      return { ignored: true, reason: "location_mismatch" };
    }
    const dispute = event.data.object.dispute;
    return this.call("process_square_dispute_event", {
      p_square_event_id: event.event_id,
      p_event_type: event.type,
      p_merchant_id: event.merchant_id,
      p_location_id: event.location_id,
      p_square_created_at: event.created_at,
      p_payload_sha256: payloadHash,
      p_event_data: {
        amountCents: dispute.amount_money.amount,
        currency: dispute.amount_money.currency,
        disputeId: dispute.id,
        disputeState: dispute.state,
        dueAt: dispute.due_at ?? null,
        paymentId: dispute.disputed_payment.payment_id,
        reason: dispute.reason,
      },
      p_square_dispute_id: dispute.id,
      p_square_payment_id: dispute.disputed_payment.payment_id,
      p_dispute_state: dispute.state,
      p_dispute_reason: dispute.reason,
      p_due_at: dispute.due_at ?? null,
      p_amount_cents: dispute.amount_money.amount,
      p_currency: dispute.amount_money.currency,
    });
  }

  private async call(
    name:
      | "process_square_payment_event"
      | "process_square_refund_event"
      | "process_square_dispute_event",
    args: Record<string, Json | string | number | null>,
  ): Promise<SquarePaymentEventResult> {
    const { data, error } = await this.supabase.rpc(name, args as never);
    if (error) {
      throw error;
    }

    const result = processResultSchema.safeParse(data);
    if (!result.success) {
      throw new Error("square_webhook_invalid_process_result");
    }
    return {
      duplicate: result.data.duplicate,
      fulfillmentAuthorized: result.data.fulfillment_authorized,
      orderId: result.data.order_id ?? null,
    };
  }
}
