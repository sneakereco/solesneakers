import { z } from "zod";

const bindings = {
  orderId: z.string().min(1),
  cartHash: z.string().min(1),
  totalCents: z.number().int().positive(),
  method: z.enum(["card", "afterpay", "applePay", "cashAppPay"]),
  deviceSessionId: z.string().min(1),
  normalizedEmailHash: z.string().min(1),
  squareIdempotencyKey: z.string().uuid(),
};

export const legacyPaymentPermitSchema = z
  .object({
    tenantId: z.string().min(1),
    ...bindings,
  })
  .strict();

const tenantFreePermitSchema = z.object({ version: z.literal(2), ...bindings }).strict();
const consumedPermitSchema = z.union([legacyPaymentPermitSchema, tenantFreePermitSchema]);

export type ConsumedPaymentPermit = z.infer<typeof consumedPermitSchema>;

export function readPaymentPermit(value: unknown): ConsumedPaymentPermit {
  return consumedPermitSchema.parse(value);
}

export function permitMatchesLegacyTenant(
  permit: ConsumedPaymentPermit,
  tenantId: string,
) {
  return "tenantId" in permit ? permit.tenantId === tenantId : true;
}
