import Link from "next/link";

export function CheckoutUnavailable() {
  return (
    <section className="mx-auto max-w-xl px-6 py-24 text-center">
      <p className="mb-3 text-xs uppercase tracking-[0.2em] text-zinc-500">Checkout</p>
      <h1 className="mb-4 text-3xl font-medium text-black">Checkout is temporarily unavailable</h1>
      <p className="mx-auto mb-8 max-w-md text-sm leading-6 text-zinc-600">
        Online payment is paused while the store transitions to a new payment and tax service.
        Your cart is still saved.
      </p>
      <Link href="/cart" className="inline-flex min-w-48 justify-center bg-black px-6 py-3 text-sm uppercase tracking-wide text-white">
        Return to cart
      </Link>
    </section>
  );
}
