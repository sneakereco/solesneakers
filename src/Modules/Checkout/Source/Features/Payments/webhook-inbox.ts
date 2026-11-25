import { z } from "zod";
import type { AdminSupabaseClient } from "@/lib/supabase/service-role";

const providerReference = z.string().regex(/^[A-Za-z0-9._:=+\-]{1,128}$/);

const squareEventKind = z.enum([
  "payment.created",
  "payment.updated",
  "refund.created",
  "refund.updated",
  "dispute.created",
  "dispute.state.updated",
]);

// Persist lookup references for a later authoritative read of the provider object.
const squareEventPayload = z.strictObject({
  merchantId: providerReference,
  locationId: providerReference,
  createdAt: z.iso.datetime({ offset: true }).max(35),
  paymentId: providerReference,
  squareOrderId: providerReference.optional(),
  refundId: providerReference.optional(),
  disputeId: providerReference.optional(),
});

const squareEventReceipt = z
  .strictObject({
    eventId: providerReference,
    kind: squareEventKind,
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
    payload: squareEventPayload,
  })
  .refine(
    ({ kind, payload }) =>
      kind.startsWith("refund.") === (payload.refundId !== undefined) &&
      kind.startsWith("dispute.") === (payload.disputeId !== undefined),
  );

export type SquareEventKind = z.infer<typeof squareEventKind>;
export type SquareEventPayload = z.infer<typeof squareEventPayload>;
export type SquareEventReceiptInput = z.infer<typeof squareEventReceipt>;

export class SquareWebhookInbox {
  constructor(private readonly client: Pick<AdminSupabaseClient, "rpc">) {}

  async receiveSquareEvent(
    input: SquareEventReceiptInput,
  ): Promise<"stored" | "duplicate"> {
    const receipt = squareEventReceipt.safeParse(input);
    if (!receipt.success) throw new Error("Invalid Square receipt payload");
    const { eventId, kind, payloadHash, payload } = receipt.data;
    const { data, error } = await this.client.rpc("receive_checkout_square_event", {
      p_event_id: eventId,
      p_kind: kind,
      p_payload_hash: payloadHash,
      p_payload: payload,
    });
    if (error) throw error;
    if (data !== "stored" && data !== "duplicate")
      throw new Error("Invalid Square receipt");
    return data;
  }
}
