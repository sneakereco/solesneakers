// src/components/orders/OrderStatusView.tsx
"use client";

import type { OrderStatusResponse } from "@/types/domain/checkout";

const formatEventType = (type: string) =>
  type.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const formatDate = (value: string) =>
  new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export function OrderStatusView({ status }: { status: OrderStatusResponse }) {
  const instructions = status.pickupInstructions
    ? status.pickupInstructions.split("\n").filter(Boolean)
    : [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold text-white">Order status</h1>
        <p className="text-gray-400">Order ID: {status.id}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded border border-zinc-800/70 bg-zinc-900 p-6">
            <h2 className="mb-4 text-xl font-semibold text-white">Status</h2>
            <div className="flex items-center justify-between text-gray-400">
              <span>Current</span>
              <span className="font-semibold capitalize text-white">{status.status}</span>
            </div>
            <div className="mt-4 space-y-3">
              {status.events.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  Timeline updates will appear here.
                </p>
              ) : (
                status.events.map((event) => (
                  <div
                    key={`${event.type}-${event.createdAt}`}
                    className="rounded border border-zinc-800/70 p-4"
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span className="text-sm font-semibold text-white">
                        {formatEventType(event.type)}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {formatDate(event.createdAt)}
                      </span>
                    </div>
                    {event.message && (
                      <p className="text-sm text-zinc-400">{event.message}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {status.fulfillment === "pickup" && instructions.length > 0 && (
            <div className="rounded border border-zinc-800/70 bg-zinc-900 p-6">
              <h2 className="mb-3 text-xl font-semibold text-white">
                Pickup instructions
              </h2>
              <ul className="space-y-2 text-sm text-zinc-400">
                {instructions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded border border-zinc-800/70 bg-zinc-900 p-6">
            <h2 className="mb-3 text-xl font-semibold text-white">Need help?</h2>
            <p className="mb-3 text-sm text-zinc-400">
              Email us at{" "}
              <a
                className="text-red-400 hover:text-red-300"
                href={`mailto:${status.supportEmail}`}
              >
                {status.supportEmail}
              </a>{" "}
              for order questions or scheduling pickup.
            </p>
            <p className="text-xs text-zinc-500">
              Prefer socials? DM us on{" "}
              <a
                href="https://instagram.com/soles.neakers"
                className="text-red-400 hover:text-red-300"
                target="_blank"
                rel="noreferrer"
              >
                Instagram @soles.neakers
              </a>
              .
            </p>
          </div>
        </div>

        <div className="h-fit rounded border border-zinc-800/70 bg-zinc-900 p-6">
          <h2 className="mb-4 text-lg font-semibold text-white">Order summary</h2>
          <div className="space-y-2 text-sm text-zinc-400">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>${status.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span>Shipping</span>
              <span>
                {status.fulfillment === "pickup"
                  ? "Free (Pickup)"
                  : `$${status.shipping.toFixed(2)}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Tax</span>
              <span>${status.tax.toFixed(2)}</span>
            </div>
            <div className="mt-2 border-t border-zinc-800/70 pt-2">
              <div className="flex justify-between font-semibold text-white">
                <span>Total</span>
                <span>${status.total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
