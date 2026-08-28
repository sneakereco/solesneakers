import { createHash } from "node:crypto";

import { z } from "zod";

import type { TypedSupabaseClient } from "@/lib/supabase/server";
import type { Json } from "@/types/db/database.types";

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
        status: z.string().min(1),
        amount_money: z.object({
          amount: z.number().int().nonnegative(),
          currency: z.string().length(3),
        }),
        risk_evaluation: z
          .object({
            risk_level: z.string().min(1),
          })
          .optional(),
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
    };

export class SquarePaymentEventProcessor {
  constructor(
    private readonly supabase: TypedSupabaseClient,
    private readonly expectedLocationId: string,
  ) {}

  async process(rawBody: string): Promise<SquarePaymentEventResult> {
    let unknownEvent: unknown;
    try {
      unknownEvent = JSON.parse(rawBody);
    } catch {
      throw new Error("square_webhook_invalid_event");
    }

    const parsed = paymentEventSchema.safeParse(unknownEvent);
    if (!parsed.success) {
      throw new Error("square_webhook_invalid_event");
    }

    const event = parsed.data;
    const payment = event.data.object.payment;
    if (payment.location_id !== this.expectedLocationId) {
      return { ignored: true, reason: "location_mismatch" };
    }

    const riskLevel = payment.risk_evaluation?.risk_level ?? null;
    const eventData: Json = {
      amountCents: payment.amount_money.amount,
      currency: payment.amount_money.currency,
      paymentId: payment.id,
      paymentStatus: payment.status,
      riskLevel,
      squareOrderId: payment.order_id,
    };

    const { data, error } = await this.supabase.rpc("process_square_payment_event", {
      p_square_event_id: event.event_id,
      p_event_type: event.type,
      p_merchant_id: event.merchant_id,
      p_location_id: payment.location_id,
      p_square_created_at: event.created_at,
      p_payload_sha256: createHash("sha256").update(rawBody, "utf8").digest("hex"),
      p_event_data: eventData,
      p_square_order_id: payment.order_id,
      p_square_payment_id: payment.id,
      p_payment_status: payment.status,
      p_amount_cents: payment.amount_money.amount,
      p_currency: payment.amount_money.currency,
      p_risk_level: riskLevel,
    });

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
