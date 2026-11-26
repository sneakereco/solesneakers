"use client";
import { useState } from "react";
import { useCart } from "./CartProvider";
import type { CartItem } from "../../Contracts/Basket";
import { lineUnavailableMessage } from "../ValidateBasket/reconcile-validation";

export function BasketLineReview({ item }: { item: CartItem }) {
  if (!item.availability && !item.orderScoped && item.previousPriceCents === undefined)
    return null;
  return <ReviewActions item={item} />;
}
const price = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
function ReviewActions({ item }: { item: CartItem }) {
  const { acceptPrice, recheckAvailability } = useCart();
  const [notice, setNotice] = useState("");

  return (
    <div className="mt-2 text-sm">
      <p role="status">
        {item.orderScoped
          ? "Check the status of your existing checkout before starting another payment."
          : item.availability
            ? lineUnavailableMessage(item) +
              (item.availability === "reserved_by_other"
                ? " Another shopper reserved the available stock."
                : item.availability === "sold_out"
                  ? " Sold out."
                  : "")
            : null}
        {item.previousPriceCents !== undefined &&
          (item.previousPriceCents === item.priceCents
            ? ` Review the current price of ${price(item.priceCents)}.`
            : ` The price changed from ${price(item.previousPriceCents)} to ${price(item.priceCents)}.`)}
        {notice}
      </p>
      {(item.availability || item.orderScoped) && (
        <button
          type="button"
          className="underline"
          onClick={() =>
            void recheckAvailability().then((ok) =>
              setNotice(ok ? "" : " Availability could not be checked. Please retry."),
            )
          }
        >
          Recheck availability
        </button>
      )}
      {item.previousPriceCents !== undefined && (
        <button
          type="button"
          className="ml-2 underline"
          onClick={() =>
            void acceptPrice(item).then((result) =>
              setNotice(
                result.status === "saved"
                  ? ""
                  : " Please review the current cart and retry.",
              ),
            )
          }
        >
          Accept updated price
        </button>
      )}
    </div>
  );
}
