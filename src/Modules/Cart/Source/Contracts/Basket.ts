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

export type BasketQuantityUpdate = number | { adjustBy: 1 | -1 };

export type BasketRepairReason = "too_large" | "too_many_rows" | null;
export type BasketAccess = "checking" | "ready" | "denied" | "unavailable";
export type BasketMutationResult =
  | { status: "saved" }
  | { status: "unavailable" | "stale" };

export interface CartContextType {
  items: CartItem[];
  addItem: (item: Omit<CartItem, "quantity">) => Promise<BasketMutationResult>;
  removeItem: (productId: string, variantId: string) => Promise<BasketMutationResult>;
  updateQuantity: (
    productId: string,
    variantId: string,
    quantity: BasketQuantityUpdate,
  ) => Promise<BasketMutationResult>;
  setCartItems: (items: CartItem[]) => Promise<BasketMutationResult>;
  clearCart: () => Promise<BasketMutationResult>;
  itemCount: number;
  total: number;
  isReady: boolean;
  hasUnreadableItems: boolean;
  repairReason: BasketRepairReason;
  access: BasketAccess;
  retryAccess: () => void;
}
