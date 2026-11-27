import { z } from "zod";
import type { OrderWriteRepository } from "./order-write-repository";

const inputSchema = z
  .object({
    orderId: z.string().uuid(),
    action: z.enum(["fulfill", "pickup"]),
    carrier: z.string().trim().min(1).nullable().optional(),
    trackingNumber: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export type TrustedOrderInput = z.infer<typeof inputSchema>;

export async function writeTrustedOrder(
  input: TrustedOrderInput,
  actor: { userId: string; role: "admin" },
  deps: Pick<OrderWriteRepository, "apply">,
) {
  const validated = inputSchema.parse(input);
  const order = await deps.apply(validated, z.string().uuid().parse(actor.userId));
  return {
    orderId: order.id,
    fulfillmentStatus: validated.action === "pickup" ? "picked_up" : "shipped",
    order,
  };
}
