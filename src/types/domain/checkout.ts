// src/types/domain/checkout.ts

export type FulfillmentMethod = "ship" | "pickup";

export interface OrderStatusResponse {
  id: string;
  status: string;
  subtotal: number;
  shipping: number;
  tax: number;
  total: number;
  fulfillment: FulfillmentMethod;
  updatedAt: string;
  events: Array<{
    type: string;
    message: string | null;
    createdAt: string;
  }>;
  pickupInstructions?: string | null;
  supportEmail: string;
}
