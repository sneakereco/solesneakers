// src/types/views/cart.ts
export interface CartItem {
  productId: string;
  variantId: string;
  sizeLabel: string;
  brand: string;
  name: string;
  titleDisplay: string;
  priceCents: number;
  imageUrl: string;
  quantity: number;
  maxStock?: number;
}

export type CartLineIdentity = Pick<CartItem, "productId" | "variantId">;
