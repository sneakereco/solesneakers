import { createHash } from "node:crypto";
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

export const squareEventReceipt = z
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

export class SquareReceiptError extends Error {
  constructor(readonly status: 400 | 403 | 413) {
    super("Invalid Square webhook");
  }
}
export async function readSquareWebhookBody(request: Request): Promise<string> {
  const limit = 256 * 1024;
  if (Number(request.headers.get("content-length")) > limit)
    throw new SquareReceiptError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new SquareReceiptError(400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new SquareReceiptError(413);
      }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Buffer.concat(chunks, size),
    );
  } catch (error) {
    if (error instanceof SquareReceiptError) throw error;
    throw new SquareReceiptError(400);
  } finally {
    reader.releaseLock();
  }
}
const envelope = z.object({ type: z.string().min(1).max(128) });
const eventBody = z.object({
  merchant_id: providerReference,
  event_id: providerReference,
  created_at: squareEventPayload.shape.createdAt,
  location_id: providerReference.optional(),
  data: z.object({
    type: z.enum(["payment", "refund", "dispute"]),
    id: providerReference,
    object: z.record(z.string(), z.unknown()),
  }),
});
const objectBody = z.object({
  id: providerReference,
  location_id: providerReference.optional(),
  order_id: providerReference.optional(),
  payment_id: providerReference.optional(),
  disputed_payment: z.object({ payment_id: providerReference }).optional(),
});
export function normalizeSquareReceipt(
  raw: string,
  merchantId: string,
  locationId: string,
): SquareEventReceiptInput | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new SquareReceiptError(400);
  }
  const meta = envelope.safeParse(value);
  if (!meta.success) throw new SquareReceiptError(400);
  const kind = squareEventKind.safeParse(meta.data.type);
  if (!kind.success) return null;
  const parsed = eventBody.safeParse(value);
  if (!parsed.success) throw new SquareReceiptError(400);
  const {
    data,
    merchant_id: eventMerchant,
    event_id: eventId,
    created_at: createdAt,
    location_id: eventLocation,
  } = parsed.data;
  const object = objectBody.safeParse(data.object[data.type]);
  if (
    !object.success ||
    !kind.data.startsWith(data.type + ".") ||
    object.data.id !== data.id
  )
    throw new SquareReceiptError(400);
  const obj = object.data;
  const location = obj.location_id ?? eventLocation;
  if (
    !location ||
    (eventLocation && eventLocation !== location) ||
    !merchantId ||
    eventMerchant !== merchantId ||
    location !== locationId
  )
    throw new SquareReceiptError(403);
  const paymentId =
    data.type === "payment"
      ? obj.id
      : data.type === "refund"
        ? obj.payment_id
        : obj.disputed_payment?.payment_id;
  if (!paymentId || (data.type === "payment" && !obj.order_id))
    throw new SquareReceiptError(400);
  return {
    eventId,
    kind: kind.data,
    payloadHash: createHash("sha256").update(raw).digest("hex"),
    payload: {
      merchantId,
      locationId,
      createdAt,
      paymentId,
      ...(data.type === "payment" && obj.order_id ? { squareOrderId: obj.order_id } : {}),
      ...(data.type === "refund" ? { refundId: obj.id } : {}),
      ...(data.type === "dispute" ? { disputeId: obj.id } : {}),
    },
  };
}
