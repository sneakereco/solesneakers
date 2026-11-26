export const stockShortages = ["reserved_by_other", "sold_out", "unavailable"] as const;
export type Shortage = (typeof stockShortages)[number];
export type ValidationOrder = { orderId: string; guestAccessToken?: string };
export type BasketLine = CartItem;
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
  availability?: Shortage;
  previousPriceCents?: number;
  orderScoped?: true;
}

export const needsBasketReview = (line: CartItem) =>
  Boolean(line.availability || line.previousPriceCents !== undefined || line.orderScoped);
export type BasketQuantityUpdate = number | { adjustBy: 1 | -1 };

export type BasketRepairReason = "too_large" | "too_many_rows" | null;
export type BasketAccess = "checking" | "ready" | "denied" | "unavailable";
export type BasketMutationResult =
  | { status: "saved" }
  | { status: "unavailable" | "stale" };

export type PurchaseLine = Readonly<
  Pick<CartItem, "productId" | "variantId" | "quantity">
>;

export type CheckoutCaptureRequest = {
  readonly attemptKey: string;
  readonly expectedItems: readonly PurchaseLine[];
} & ({ readonly mode: "new" } | { readonly mode: "resume" });

export type ProofFailure = {
  status: "missing" | "stale" | "corrupt" | "mismatch" | "unavailable";
};
export type CaptureResult =
  | ProofFailure
  | {
      status: "captured";
      captureId: string;
      items: readonly PurchaseLine[];
    };
export type ConsumptionResult = ProofFailure | { status: "matched"; attemptKey: string };

export interface CartPurchaseActions {
  captureForCheckout(
    request: CheckoutCaptureRequest,
    signal?: AbortSignal,
  ): Promise<CaptureResult>;
  bindPreparedOrder(
    captureId: string,
    orderId: string,
    signal?: AbortSignal,
  ): Promise<boolean>;
  consumeConfirmedPurchase(
    orderId: string,
    purchased: readonly PurchaseLine[],
    signal?: AbortSignal,
  ): Promise<ConsumptionResult>;
}

export type StockConflict = {
  productId: string;
  variantId: string;
  requestedQuantity: number;
  availableQuantity: number;
  reason: Shortage;
};
export interface BasketReviewActions {
  recheckAvailability: () => Promise<boolean>;
  acceptPrice: (line: CartItem) => Promise<BasketMutationResult>;
  applyStockConflicts: (
    conflicts: readonly StockConflict[],
    recoveryRequired?: boolean,
  ) => Promise<BasketMutationResult>;
  scopeValidationToOrder: (order: ValidationOrder) => void;
  resetSavedBasket: () => Promise<BasketMutationResult>;
}
export interface CartContextType extends CartPurchaseActions, BasketReviewActions {
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
