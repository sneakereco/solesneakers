import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProductRepository } from "@/repositories/product-repo";
import { cartValidateSchema } from "@/lib/validation/cart";
import { getRequestIdFromHeaders } from "@/lib/http/request-id";
import { logError } from "@/lib/utils/log";
import type { CartItem } from "@/types/domain/cart";

import {
  basketImage,
  type LineState,
  type LegacyRemoval,
  type CartValidationV2,
} from "@/Modules/Cart/Source/Features/ValidateBasket/validation-contract";
import { readOwnHolds } from "@/Modules/Cart/Source/Features/ValidateBasket/own-hold";

export async function POST(request: NextRequest) {
  const requestId = getRequestIdFromHeaders(request.headers);

  try {
    const body = await request.json().catch(() => null);
    const parsed = cartValidateSchema.safeParse(body ?? {});

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", issues: parsed.error.format(), requestId },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const items = parsed.data.items ?? [];
    if (items.length === 0) {
      return NextResponse.json(
        { contractVersion: 2, lineState: [], items: [], removed: [] },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const supabase = await createSupabaseServerClient();
    const repo = new ProductRepository(supabase);
    const variantIds = [...new Set(items.map((item) => item.variantId))];
    const variants = await repo.getVariantsForCart(variantIds);
    const variantMap = new Map(variants.map((variant) => [variant.variantId, variant]));

    const nextItems: CartItem[] = [];
    const removed: LegacyRemoval[] = [];

    const holds = parsed.data.order ? await readOwnHolds(parsed.data.order) : undefined;
    const lineState: LineState[] = [];
    for (const item of items) {
      const variant = variantMap.get(item.variantId);
      const match = variant?.productId === item.productId ? variant : null;
      const hold = holds?.get(item.variantId);
      const eligible = match?.isActive && (!match.isOutOfStock || match.stock === 0);
      const availableQuantity =
        eligible && !hold?.recovery
          ? Math.max(0, match.stock) + (hold?.quantity ?? 0)
          : 0;
      // The catalog read cannot attribute a shortage to a competing shopper.
      // Preparation supplies that reason from the locked allocation transaction.
      const availability =
        availableQuantity >= item.quantity ? "available" : "unavailable";
      lineState.push({
        productId: item.productId,
        variantId: item.variantId,
        requestedQuantity: item.quantity,
        availableQuantity,
        availability,
        reason: availability,
        ...(hold && (hold.recovery || (match?.stock ?? 0) < item.quantity)
          ? { orderScoped: true }
          : {}),
        ...(match
          ? {
              facts: {
                sizeLabel: match.sizeLabel,
                brand: match.brand,
                name: match.name,
                titleDisplay:
                  match.titleDisplay || [match.brand, match.name].join(" ").trim(),
                priceCents: match.priceCents,
                imageUrl: basketImage(match.imageUrl),
              },
            }
          : {}),
      });
      if (!variant || variant.productId !== item.productId) {
        removed.push({
          productId: item.productId,
          variantId: item.variantId,
          reason: "not_found",
        });
        continue;
      }

      if (!variant.isActive || variant.isOutOfStock || variant.stock <= 0) {
        removed.push({
          productId: item.productId,
          variantId: item.variantId,
          reason: "out_of_stock",
        });
        continue;
      }

      const maxStock = Math.max(0, variant.stock);
      const quantity = Math.min(item.quantity, maxStock);

      if (quantity <= 0) {
        removed.push({
          productId: item.productId,
          variantId: item.variantId,
          reason: "insufficient_stock",
        });
        continue;
      }

      nextItems.push({
        productId: variant.productId,
        variantId: variant.variantId,
        sizeLabel: variant.sizeLabel,
        brand: variant.brand,
        name: variant.name,
        titleDisplay: variant.titleDisplay || `${variant.brand} ${variant.name}`.trim(),
        priceCents: variant.priceCents,
        imageUrl: basketImage(variant.imageUrl),
        quantity,
        maxStock,
      });
    }

    return NextResponse.json(
      {
        contractVersion: 2,
        lineState,
        items: nextItems,
        removed,
      } satisfies CartValidationV2,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: unknown) {
    logError(new Error("cart_validation_upstream_unavailable"), {
      layer: "api",
      requestId,
      route: "/api/cart/validate",
      upstreamErrorType: error instanceof Error ? error.name : typeof error,
    });

    return NextResponse.json(
      { error: "Cart validation is temporarily unavailable", requestId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
