import type { CartItem } from "@/Modules/Cart/Source/Contracts/Basket";
export type { CartItem } from "@/Modules/Cart/Source/Contracts/Basket";

export type CartLineIdentity = Pick<CartItem, "productId" | "variantId">;
