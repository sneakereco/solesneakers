// src/types/domain/checkout.ts

import type { FinancialSnapshot } from "@/Modules/Checkout/Source/Features/Payments/payment-facts";
export type ReceiptFinancialEvidence =
  | { source: "legacy" }
  | { source: "ledger"; snapshot: FinancialSnapshot }
  | { source: "unavailable" };

export type FulfillmentMethod = "ship" | "pickup";

export interface OrderStatusResponse {
  id: string;
  status: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  fulfillment: FulfillmentMethod | null;
  financial: ReceiptFinancialEvidence;
  financialReview?: boolean;
  customerId?: string | null;
  purchasedItems?: readonly { productId: string; variantId: string; quantity: number }[];
  purchasedLines?:
    | readonly { productId: string; variantId: string; quantity: number }[]
    | null;
  updatedAt: string;
  events: Array<{
    type: string;
    message: string | null;
    createdAt: string;
  }>;
  pickupInstructions?: string | null;
  supportEmail: string;
}
