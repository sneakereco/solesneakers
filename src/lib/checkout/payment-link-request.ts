import { z } from "zod";

const checkoutItemSchema = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(5),
  })
  .strict();

const shippingAddressSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(7).max(30).nullable().optional(),
    line1: z.string().trim().min(1).max(120),
    line2: z.string().trim().max(120).nullable().optional(),
    city: z.string().trim().min(1).max(80),
    state: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}(?:-\d{4})?$/),
    country: z
      .string()
      .trim()
      .toUpperCase()
      .pipe(z.literal("US")),
  })
  .strict();

export const paymentLinkRequestSchema = z
  .object({
    items: z.array(checkoutItemSchema).min(1).max(10),
    fulfillment: z.enum(["ship", "pickup"]),
    idempotencyKey: z.string().uuid(),
    deviceSessionId: z.string().uuid(),
    buyerEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
    shippingAddress: shippingAddressSchema.nullable().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const variants = new Set<string>();
    for (const [index, item] of value.items.entries()) {
      if (variants.has(item.variantId)) {
        context.addIssue({
          code: "custom",
          path: ["items", index, "variantId"],
          message: "Duplicate variants are not allowed",
        });
      }
      variants.add(item.variantId);
    }

    if (value.fulfillment === "ship" && !value.shippingAddress) {
      context.addIssue({
        code: "custom",
        path: ["shippingAddress"],
        message: "A US shipping address is required",
      });
    }

    if (value.fulfillment === "pickup" && value.shippingAddress) {
      context.addIssue({
        code: "custom",
        path: ["shippingAddress"],
        message: "Pickup checkout must not include a shipping address",
      });
    }
  });

export type PaymentLinkRequest = z.infer<typeof paymentLinkRequestSchema>;
export type PaymentLinkRequestItem = PaymentLinkRequest["items"][number];
