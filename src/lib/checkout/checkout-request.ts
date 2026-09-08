import { z } from "zod";

export const checkoutItemSchema = z
  .object({
    productId: z.string().uuid(),
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(5),
  })
  .strict();

export const checkoutShippingAddressSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    phone: z.string().trim().min(7).max(30),
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
    country: z.string().trim().toUpperCase().pipe(z.literal("US")),
  })
  .strict();

export const checkoutQuoteDestinationSchema = z
  .object({
    state: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{2}$/),
    postalCode: z
      .string()
      .trim()
      .regex(/^\d{5}(?:-\d{4})?$/),
    country: z.string().trim().toUpperCase().pipe(z.literal("US")),
  })
  .strict();

function validateUniqueVariants(
  value: { items: Array<{ variantId: string }> },
  context: z.RefinementCtx,
): void {
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
}

export const checkoutQuoteRequestSchema = z
  .object({
    items: z.array(checkoutItemSchema).min(1).max(10),
    fulfillment: z.enum(["ship", "pickup"]),
    shippingAddress: z
      .union([checkoutShippingAddressSchema, checkoutQuoteDestinationSchema])
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    validateUniqueVariants(value, context);
    if (value.fulfillment === "pickup" && value.shippingAddress) {
      context.addIssue({
        code: "custom",
        path: ["shippingAddress"],
        message: "Pickup checkout must not include a shipping address",
      });
    }
  });

export const prepareCheckoutRequestSchema = z
  .object({
    items: z.array(checkoutItemSchema).min(1).max(10),
    fulfillment: z.enum(["ship", "pickup"]),
    idempotencyKey: z.string().uuid(),
    deviceSessionId: z.string().uuid(),
    quoteFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    buyerEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional(),
    shippingAddress: checkoutShippingAddressSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    validateUniqueVariants(value, context);

    if (value.fulfillment === "ship" && !value.shippingAddress) {
      context.addIssue({
        code: "custom",
        path: ["shippingAddress"],
        message: "Shipping checkout requires an address",
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

export const paymentMethodSchema = z.enum([
  "card",
  "afterpay",
  "applePay",
  "googlePay",
  "cashAppPay",
]);

export const paymentPermitRequestSchema = z
  .object({
    orderId: z.string().uuid(),
    guestAccessToken: z.string().trim().min(1).max(512).nullable().optional(),
    deviceSessionId: z.string().uuid(),
    method: paymentMethodSchema,
    turnstileToken: z.string().trim().min(1).max(2048).nullable().optional(),
  })
  .strict();

export const directPaymentRequestSchema = z
  .object({
    permit: z.string().trim().min(1).max(200),
    sourceId: z.string().trim().min(1).max(2048),
  })
  .strict();

export type PrepareCheckoutRequest = z.infer<typeof prepareCheckoutRequestSchema>;
export type PrepareCheckoutRequestItem = PrepareCheckoutRequest["items"][number];
export type CheckoutQuoteRequest = z.infer<typeof checkoutQuoteRequestSchema>;
export type CheckoutTotals = {
  subtotalCents: number;
  shippingCents: number;
  taxCents: number;
  totalCents: number;
};
export type CheckoutQuoteResponse =
  | {
      completeness: "preliminary";
      totals: Omit<CheckoutTotals, "taxCents"> & { taxCents: null };
      quoteFingerprint: null;
    }
  | {
      completeness: "exact";
      totals: CheckoutTotals;
      quoteFingerprint: string;
    };
export type ExactCheckoutQuote = Extract<
  CheckoutQuoteResponse,
  { completeness: "exact" }
>;
export type PaymentPermitRequest = z.infer<typeof paymentPermitRequestSchema>;
export type DirectPaymentRequest = z.infer<typeof directPaymentRequestSchema>;
