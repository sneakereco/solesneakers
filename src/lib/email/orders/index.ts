// src/lib/email/orders/index.ts
export { buildOrderConfirmationEmail } from "@/lib/email/orders/confirmation";
export { buildResellerOrderPlacedEmail } from "@/lib/email/orders/reseller-order-placed";
export { buildPickupInstructionsEmail } from "@/lib/email/orders/pickup-instructions";
export { buildOrderLabelCreatedEmail } from "@/lib/email/orders/label-created";
export { buildOrderInTransitEmail } from "@/lib/email/orders/in-transit";
export { buildOrderDeliveredEmail } from "@/lib/email/orders/delivered";
export { buildOrderRefundedEmail } from "@/lib/email/orders/refunded";
export type {
  AdminOrderPlacedEmailInput,
  OrderConfirmationEmailInput,
  OrderDeliveredEmailInput,
  OrderInTransitEmailInput,
  OrderLabelCreatedEmailInput,
  OrderRefundedEmailInput,
  OrderItemEmail,
  OrderTrackingEmailBase,
  PickupInstructionsEmailInput,
  ShippingAddress,
} from "@/types/domain/email";
