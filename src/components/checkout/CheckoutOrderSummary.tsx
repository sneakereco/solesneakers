import { BasketLineReview, needsBasketReview } from "@/Modules/Cart/Source/Client";
import Image from "next/image";
import { Skeleton } from "@/components/ui/Skeleton";

import type { CheckoutQuoteResponse } from "@/lib/checkout/checkout-request";
import type { CartItem } from "@/types/domain/cart";

export type CheckoutQuoteState =
  | { status: "loading"; quote?: CheckoutQuoteResponse }
  | { status: "ready"; quote: CheckoutQuoteResponse }
  | { status: "error"; message: string; quote?: CheckoutQuoteResponse };

function formatPrice(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function CheckoutOrderSummary({
  items,
  quoteState,
  onRetry,
  className = "",
}: {
  items: CartItem[];
  quoteState: CheckoutQuoteState;
  onRetry?: () => void;
  className?: string;
}) {
  const cartSubtotal = items.reduce(
    (sum, item) => sum + (needsBasketReview(item) ? 0 : item.priceCents * item.quantity),
    0,
  );
  const loading = quoteState.status === "loading";
  const quote =
    quoteState.status === "ready" && !items.some(needsBasketReview)
      ? quoteState.quote
      : undefined;
  const pendingAmount = loading ? (
    <Skeleton className="h-4 w-16 rounded" />
  ) : (
    "Unavailable"
  );
  const subtotal = quote?.totals.subtotalCents ?? cartSubtotal;
  const shipping = quote?.totals.shippingCents;
  const exact = quote?.completeness === "exact" ? quote : null;
  const total = quote?.totals.totalCents;

  return (
    <aside
      className={`${className} border-b border-[#d3d3d3] bg-[#f3f3f3] px-5 py-8 text-zinc-950 lg:min-h-[calc(100vh-7rem)] lg:border-b-0 lg:border-l lg:px-10 lg:py-16`}
      aria-labelledby="order-summary-heading"
    >
      <h2 id="order-summary-heading" className="sr-only">
        Order summary
      </h2>
      <div className="w-full max-w-[25rem]">
        <div className="space-y-5">
          {items.map((item) => (
            <div key={`${item.productId}-${item.variantId}`} className="flex gap-4">
              <div className="relative h-20 w-20 shrink-0 rounded-xl border border-zinc-200 bg-white">
                <Image
                  src={item.imageUrl}
                  alt={item.titleDisplay}
                  fill
                  sizes="80px"
                  className="object-contain p-1 mix-blend-multiply"
                />
                <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-zinc-700 px-1 text-xs text-white">
                  {item.quantity}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{item.titleDisplay}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  Size {item.sizeLabel} · Qty {item.quantity}
                </p>
                {(item.availability ||
                  item.previousPriceCents !== undefined ||
                  item.orderScoped) && <BasketLineReview item={item} />}
              </div>
              <p className="text-sm font-medium">
                {item.availability
                  ? "Unavailable"
                  : formatPrice(item.priceCents * item.quantity)}
              </p>
            </div>
          ))}
        </div>

        {loading && (
          <p role="status" className="mt-5 text-sm">
            Updating totals…
          </p>
        )}
        <dl
          aria-busy={loading}
          className="mt-8 space-y-3 border-t border-zinc-200 pt-6 text-sm"
        >
          <div className="flex justify-between gap-4">
            <dt>Subtotal</dt>
            <dd>{formatPrice(subtotal)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Shipping</dt>
            <dd>{shipping === undefined ? pendingAmount : formatPrice(shipping)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Tax</dt>
            <dd>
              {exact
                ? formatPrice(exact.totals.taxCents)
                : quote
                  ? "Calculated after address"
                  : pendingAmount}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-zinc-200 pt-4 text-lg font-semibold">
            <dt>{!quote || exact ? "Total" : "Estimated total"}</dt>
            <dd>{total === undefined ? pendingAmount : formatPrice(total)}</dd>
          </div>
        </dl>
        {quoteState.status === "error" && (
          <p className="mt-4 text-sm text-amber-800" role="alert">
            {quoteState.message}{" "}
            {onRetry && (
              <button type="button" className="ml-2 underline" onClick={onRetry}>
                Retry totals
              </button>
            )}
          </p>
        )}
      </div>
    </aside>
  );
}
